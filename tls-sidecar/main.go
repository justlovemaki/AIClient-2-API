package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	utls "github.com/refraction-networking/utls"
	"golang.org/x/net/http2"
	"golang.org/x/net/proxy"
)

// ──────────────────────────────────────────────
// TLS Sidecar — Go uTLS reverse proxy
//
// Node.js 发请求到 http://127.0.0.1:<port>，
// 通过以下自定义 Header 传递目标信息：
//   X-Target-Url:   实际目标 URL（必填）
//   X-Proxy-Url:    上游代理（可选，支持 http/socks5）
//
// 所有其他 Header 原样转发给目标服务器。
// 响应（包括 SSE 流式）透传回 Node.js。
//
// uTLS 使用 Chrome 最新指纹，ALPN 协商 h2/http1.1，
// 根据服务器返回的 ALPN 自动选择 HTTP/2 或 HTTP/1.1 传输。
// ──────────────────────────────────────────────

const (
	defaultPort  = 9090
	headerTarget = "X-Target-Url"
	headerProxy  = "X-Proxy-Url"
	readTimeout  = 30 * time.Second
	writeTimeout = 0 // SSE 流式响应不设写超时（仅监听 localhost，安全）
	idleTimeout  = 120 * time.Second
)

// 全局 RoundTripper 缓存（按 proxyURL 分组，复用 H2 连接）
var (
	rtCacheMu sync.Mutex
	rtCache   = make(map[string]*utlsRoundTripper)
)

func getOrCreateRT(proxyURL string) *utlsRoundTripper {
	rtCacheMu.Lock()
	defer rtCacheMu.Unlock()
	if rt, ok := rtCache[proxyURL]; ok {
		return rt
	}
	rt := newUTLSRoundTripper(proxyURL)
	rtCache[proxyURL] = rt
	return rt
}

// ──────────────── uTLS RoundTripper ────────────────
// 根据 ALPN 协商结果自动选择 H2 或 H1 传输

type utlsRoundTripper struct {
	proxyURL string

	mu      sync.Mutex
	h2Conns map[string]*http2.ClientConn // H2 连接缓存 (per host)
}

func newUTLSRoundTripper(proxyURL string) *utlsRoundTripper {
	return &utlsRoundTripper{
		proxyURL: proxyURL,
		h2Conns:  make(map[string]*http2.ClientConn),
	}
}

func (rt *utlsRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	addr := req.URL.Host
	if !strings.Contains(addr, ":") {
		if req.URL.Scheme == "https" {
			addr += ":443"
		} else {
			addr += ":80"
		}
	}

	// 尝试复用已有的 H2 连接
	rt.mu.Lock()
	if cc, ok := rt.h2Conns[addr]; ok {
		rt.mu.Unlock()
		if cc.CanTakeNewRequest() {
			resp, err := cc.RoundTrip(req)
			if err == nil {
				return resp, nil
			}
			// H2 连接已失效，清除缓存重建
			log.Printf("[TLS-Sidecar] Cached H2 conn failed for %s: %v, reconnecting", addr, err)
		}
		rt.mu.Lock()
		delete(rt.h2Conns, addr)
		rt.mu.Unlock()
	} else {
		rt.mu.Unlock()
	}

	// 建立新的 uTLS 连接
	conn, err := dialUTLS(req.Context(), "tcp", addr, rt.proxyURL)
	if err != nil {
		return nil, err
	}

	// 根据 ALPN 协商结果决定走 H2 还是 H1
	alpn := conn.ConnectionState().NegotiatedProtocol
	log.Printf("[TLS-Sidecar] Connected to %s, ALPN: %q", addr, alpn)

	if alpn == "h2" {
		// HTTP/2: 创建 H2 ClientConn
		t2 := &http2.Transport{
			StrictMaxConcurrentStreams: true,
			AllowHTTP:                  false,
		}
		cc, err := t2.NewClientConn(conn)
		if err != nil {
			conn.Close()
			return nil, fmt.Errorf("h2 client conn: %w", err)
		}

		rt.mu.Lock()
		rt.h2Conns[addr] = cc
		rt.mu.Unlock()

		return cc.RoundTrip(req)
	}

	// HTTP/1.1: 通过一次性 Transport 使用已建立的 TLS 连接
	// DialTLSContext 返回已完成 TLS 握手的 conn，http.Transport 不会重复握手
	used := false
	t1 := &http.Transport{
		DialTLSContext: func(ctx context.Context, network, a string) (net.Conn, error) {
			if !used {
				used = true
				return conn, nil
			}
			// 后续连接走正常 uTLS dial
			return dialUTLS(ctx, network, a, rt.proxyURL)
		},
		MaxIdleConnsPerHost: 1,
		IdleConnTimeout:     90 * time.Second,
	}

	resp, err := t1.RoundTrip(req)
	if err != nil {
		conn.Close()
		t1.CloseIdleConnections()
	}
	return resp, err
}

func (rt *utlsRoundTripper) CloseIdleConnections() {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	for k, cc := range rt.h2Conns {
		cc.Close()
		delete(rt.h2Conns, k)
	}
}

// ──────────────── Main ────────────────

func main() {
	// 强制将日志输出到 Stdout，避免 Node.js 侧将其误判为 Error
	log.SetOutput(os.Stdout)

	port := defaultPort
	if p := os.Getenv("TLS_SIDECAR_PORT"); p != "" {
		if v, err := strconv.Atoi(p); err == nil {
			port = v
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/", handleProxy)

	srv := &http.Server{
		Addr:         fmt.Sprintf("127.0.0.1:%d", port),
		Handler:      mux,
		ReadTimeout:  readTimeout,
		WriteTimeout: writeTimeout,
		IdleTimeout:  idleTimeout,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("[TLS-Sidecar] Shutting down...")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
	}()

	log.Printf("[TLS-Sidecar] Listening on 127.0.0.1:%d (Chrome uTLS, H2+H1 auto)\n", port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[TLS-Sidecar] Fatal: %v", err)
	}
}

// ──────────────── Health ────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(200)
	fmt.Fprintf(w, `{"status":"ok","tls":"utls-chrome-auto","protocols":"h2,http/1.1"}`)
}

// ──────────────── Proxy Handler ────────────────

func handleProxy(w http.ResponseWriter, r *http.Request) {
	targetURL := r.Header.Get(headerTarget)
	if targetURL == "" {
		http.Error(w, `{"error":"missing X-Target-Url header"}`, http.StatusBadRequest)
		return
	}

	proxyURL := r.Header.Get(headerProxy)

	// Parse target
	parsed, err := url.Parse(targetURL)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid target url: %s"}`, err), http.StatusBadRequest)
		return
	}

	// Build outgoing request
	outReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to create request: %s"}`, err), http.StatusInternalServerError)
		return
	}

	// Copy headers (skip internal + hop-by-hop)
	// 403 关键修复：彻底清理所有非浏览器标头，严格保持小写
	for key, vals := range r.Header {
		lk := strings.ToLower(key)
		if lk == strings.ToLower(headerTarget) || lk == strings.ToLower(headerProxy) {
			continue
		}
		// 移除所有代理、本地网络特征标头，防止 Cloudflare 识别
		if lk == "connection" || lk == "keep-alive" || lk == "transfer-encoding" ||
			lk == "te" || lk == "trailer" || lk == "upgrade" || lk == "host" ||
			lk == "x-forwarded-for" || lk == "x-real-ip" || lk == "x-forwarded-proto" ||
			lk == "x-forwarded-host" || lk == "via" || lk == "proxy-connection" ||
			lk == "cf-connecting-ip" || lk == "true-client-ip" {
			continue
		}
		// 直接通过 map 赋值，确保 Go 的 http2 栈能识别并以原始（小写）形式发出
		outReq.Header[key] = vals
	}
	outReq.Host = parsed.Host

	// 针对 Grok 的特殊处理：如果 Accept-Encoding 包含 br 且环境可能存在压缩协商问题
	// 强制设置为标准的浏览器组合
	if ae := outReq.Header["Accept-Encoding"]; len(ae) > 0 {
		outReq.Header["Accept-Encoding"] = []string{"gzip, deflate, br, zstd"}
	}

	// Execute via uTLS RoundTripper
	rt := getOrCreateRT(proxyURL)
	resp, err := rt.RoundTrip(outReq)
	if err != nil {
		log.Printf("[TLS-Sidecar] RoundTrip error → %s: %v", parsed.Host, err)
		http.Error(w, fmt.Sprintf(`{"error":"upstream request failed: %s"}`, err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Copy response headers
	for key, vals := range resp.Header {
		for _, v := range vals {
			w.Header().Add(key, v)
		}
	}
	w.WriteHeader(resp.StatusCode)

	// Stream body (SSE-friendly: flush after every read)
	flusher, canFlush := w.(http.Flusher)
	buf := make([]byte, 32*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := w.Write(buf[:n]); writeErr != nil {
				log.Printf("[TLS-Sidecar] Write error: %v", writeErr)
				return
			}
			if canFlush {
				flusher.Flush()
			}
		}
		if readErr != nil {
			if readErr != io.EOF {
				log.Printf("[TLS-Sidecar] Read error: %v", readErr)
			}
			return
		}
	}
}

// ──────────────── uTLS Dial ────────────────

func dialUTLS(ctx context.Context, network, addr string, proxyURL string) (*utls.UConn, error) {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		host = addr
	}

	// TCP 连接（可能经过代理）
	var rawConn net.Conn
	if proxyURL != "" {
		rawConn, err = dialViaProxy(ctx, network, addr, proxyURL)
	} else {
		var d net.Dialer
		rawConn, err = d.DialContext(ctx, network, addr)
	}
	if err != nil {
		return nil, fmt.Errorf("tcp dial failed: %w", err)
	}

	// uTLS 握手 — 使用 Chrome 最新自动指纹
	// 403 错误通过保持标头小写和清理转发标头来解决
	tlsConn := utls.UClient(rawConn, &utls.Config{
		ServerName: host,
		NextProtos: []string{"h2", "http/1.1"},
	}, utls.HelloChrome_Auto)

	// 握手超时
	if deadline, ok := ctx.Deadline(); ok {
		tlsConn.SetDeadline(deadline)
	} else {
		tlsConn.SetDeadline(time.Now().Add(15 * time.Second))
	}

	if err := tlsConn.Handshake(); err != nil {
		rawConn.Close()
		return nil, fmt.Errorf("utls handshake failed: %w", err)
	}

	// 握手完成，清除超时
	tlsConn.SetDeadline(time.Time{})
	return tlsConn, nil
}

// ──────────────── Proxy Dialer ────────────────

func dialViaProxy(ctx context.Context, network, addr string, proxyURL string) (net.Conn, error) {
	parsed, err := url.Parse(proxyURL)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy url: %w", err)
	}

	switch strings.ToLower(parsed.Scheme) {
	case "socks5", "socks5h", "socks4", "socks":
		var auth *proxy.Auth
		if parsed.User != nil {
			auth = &proxy.Auth{
				User: parsed.User.Username(),
			}
			auth.Password, _ = parsed.User.Password()
		}
		dialer, err := proxy.SOCKS5("tcp", parsed.Host, auth, &net.Dialer{
			Timeout: 15 * time.Second,
		})
		if err != nil {
			return nil, fmt.Errorf("socks5 dialer: %w", err)
		}
		if ctxDialer, ok := dialer.(proxy.ContextDialer); ok {
			return ctxDialer.DialContext(ctx, network, addr)
		}
		return dialer.Dial(network, addr)

	case "http", "https":
		proxyConn, err := net.DialTimeout("tcp", parsed.Host, 15*time.Second)
		if err != nil {
			return nil, fmt.Errorf("connect to http proxy: %w", err)
		}

		connectReq := fmt.Sprintf("CONNECT %s HTTP/1.1\r\nHost: %s\r\n", addr, addr)
		if parsed.User != nil {
			username := parsed.User.Username()
			password, _ := parsed.User.Password()
			cred := base64.StdEncoding.EncodeToString([]byte(username + ":" + password))
			connectReq += fmt.Sprintf("Proxy-Authorization: Basic %s\r\n", cred)
		}
		connectReq += "\r\n"

		if _, err = proxyConn.Write([]byte(connectReq)); err != nil {
			proxyConn.Close()
			return nil, fmt.Errorf("proxy CONNECT write: %w", err)
		}

		buf := make([]byte, 4096)
		n, err := proxyConn.Read(buf)
		if err != nil {
			proxyConn.Close()
			return nil, fmt.Errorf("proxy CONNECT read: %w", err)
		}
		if !strings.Contains(string(buf[:n]), "200") {
			proxyConn.Close()
			return nil, fmt.Errorf("proxy CONNECT rejected: %s", strings.TrimSpace(string(buf[:n])))
		}

		return proxyConn, nil

	default:
		return nil, fmt.Errorf("unsupported proxy scheme: %s", parsed.Scheme)
	}
}
