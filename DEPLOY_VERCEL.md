# 🚀 Hướng Dẫn Deploy AIClient-2-API Lên Vercel

Hướng dẫn chi tiết từng bước để deploy dự án AIClient-2-API lên Vercel và cấu hình Credentials (Gemini, Antigravity, Qwen) một cách an toàn.

## 📋 Mục lục
1. [Chuẩn bị Credentials (File Token)](#1-chuẩn-bị-credentials)
2. [Cài đặt Vercel CLI hoặc Deploy qua Git](#2-deploy-lên-vercel)
3. [Cấu hình Environment Variables](#3-cấu-hình-environment-variables)
4. [Hoàn tất và Test](#4-hoàn-tất-và-test)

---

## 1. Chuẩn bị Credentials

Vì Vercel là môi trường serverless và không hỗ trợ lưu file trực tiếp lâu dài, chúng ta sẽ chuyển nội dung các file credential (JSON) thành chuỗi **Base64** để lưu vào biến môi trường (Environment Variables).

Bạn cần chuẩn bị các file sau (nếu có sử dụng):
- `oauth_creds.json` của **Gemini CLI** (thường ở `~/.gemini/oauth_creds.json`)
- `oauth_creds.json` của **Antigravity** (thường ở `~/.antigravity/oauth_creds.json`)
- `oauth_creds.json` của **Qwen** (thường ở `~/.qwen/oauth_creds.json`)
- `kiro-auth-token.json` của **Kiro** (thường ở `~/.aws/sso/cache/kiro-auth-token.json`)

### Cách chuyển File sang Base64

**Trên Linux / macOS:**
Mở terminal và chạy lệnh sau (thay đường dẫn tương ứng):

```bash
# Gemini
base64 -w 0 ~/.gemini/oauth_creds.json

# Antigravity
base64 -w 0 ~/.antigravity/oauth_creds.json

# Qwen
base64 -w 0 ~/.qwen/oauth_creds.json
```

**Trên Windows (PowerShell):**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.gemini\oauth_creds.json"))
```

> ⚠️ **Lưu ý:** Copy toàn bộ chuỗi ký tự dài được in ra. Đó chính là giá trị bạn sẽ điền vào Vercel.

---

## 2. Deploy lên Vercel

Có 2 cách phổ biến:

### Cách A: Dùng Vercel CLI (Nhanh nhất từ máy cá nhân)
Nếu chưa có tài khoản, hãy đăng ký tại [vercel.com](https://vercel.com).

1. Cài đặt Vercel CLI:
   ```bash
   npm i -g vercel
   ```
2. Đăng nhập:
   ```bash
   vercel login
   ```
3. Đứng tại thư mục gốc của dự án `AIClient-2-API`, chạy lệnh:
   ```bash
   vercel
   ```
   - Set up and deploy? **Yes**
   - Link to existing project? **No**
   - Project Name: `aiclient-api` (hoặc tên tùy ý)
   - Directory: `./` (mặc định)
   - Nó sẽ hỏi về settings, bạn cứ Enter để skip, chúng ta sẽ cấu hình Env Vars sau.

### Cách B: Qua GitHub/GitLab
1. Push code lên GitHub/GitLab.
2. Vào Dashboard Vercel -> **Add New...** -> **Project**.
3. Import repo của bạn.
4. Ở phần **Framework Preset**, chọn **Other**.
5. **Build Command**: Để trống (hoặc `echo 'No build needed'`).
6. **Output Directory**: `.` (hoặc để mặc định).

---

## 3. Cấu hình Environment Variables

Đây là bước quan trọng nhất để ứng dụng chạy được.

1. Vào Dashboard dự án trên Vercel > Tab **Settings** > **Environment Variables**.
2. Thêm các biến sau:

| Tên Biến (Key) | Giá Trị (Value) | Mô tả |
| :--- | :--- | :--- |
| `MODEL_PROVIDER` | `gemini-cli-oauth` | Provider mặc định (hoặc `gemini-antigravity`, `openai-custom`...) |
| `GEMINI_OAUTH_CREDS_BASE64` | `...chuỗi base64...` | Chuỗi Base64 của file `~/.gemini/oauth_creds.json` |
| `ANTIGRAVITY_OAUTH_CREDS_BASE64` | `...chuỗi base64...` | Chuỗi Base64 của file `~/.antigravity/oauth_creds.json` |
| `QWEN_OAUTH_CREDS_BASE64` | `...chuỗi base64...` | Chuỗi Base64 của file `~/.qwen/oauth_creds.json` |
| `KIRO_OAUTH_CREDS_BASE64` | `...chuỗi base64...` | (Nếu dùng Kiro) Chuỗi Base64 token |
| `PROJECT_ID` | `your-google-cloud-project-id` | Project ID Google Cloud của bạn (cần cho Gemini/Antigravity) |

### Các biến tùy chọn khác (Optional)
| Tên Biến | Giá Trị Mặc Định | Mô tả |
| :--- | :--- | :--- |
| `REQUIRED_API_KEY` | `123456` | Khóa bảo vệ API của bạn. Nên đổi để bảo mật. |
| `WEB_UI_PASSWORD` | `admin123` | Mật khẩu truy cập Web UI (`/login.html`). Mặc định là `admin123`. |
| `OPENAI_API_KEY` | | Nếu dùng `openai-custom` |
| `OPENAI_BASE_URL` | | Nếu dùng `openai-custom` |
| `CLAUDE_API_KEY` | | Nếu dùng `claude-custom` |

Sau khi Add xong các biến, nếu bạn đã deploy rồi thì cần **Redeploy** (Vào tab Deployments -> Redeploy) để biến môi trường có hiệu lực.

---

## 4. Cấu hình Domain (Alias) và Test

### Đặt Alias (Tên miền phụ)
Để dễ nhớ, bạn có thể đặt alias cho dự án:

```bash
vercel alias set https://your-deployment-url.vercel.app your-alias-name.vercel.app
```

### Test API
Sau khi deploy thành công, test thử bằng `curl`:

**Health Check:**
```bash
curl https://your-alias-name.vercel.app/health
```

**Chat Completion (Ví dụ Gemini):**
```bash
curl -X POST https://your-alias-name.vercel.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_REQUIRED_API_KEY" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [
      {"role": "user", "content": "Hello Vercel!"}
    ]
  }'
```

---

## 5. Troubleshooting (Khắc phục lỗi)

### 🔴 Lỗi "Authentication Required" (trả về HTML thay vì JSON)
Nếu bạn gọi API mà nhận được nội dung HTML `<!doctype html>...<title>Authentication Required</title>`, nguyên nhân là do tính năng **Deployment Protection** của Vercel đang bật.

**Cách tắt:**
1.  Truy cập Dashboard dự án trên [vercel.com](https://vercel.com).
2.  Vào tab **Settings** -> **Deployment Protection**.
3.  Tìm phần **Vercel Authentication**.
4.  Chuyển trạng thái sang **Disabled**.
5.  Nhấn **Save**.

### 🔴 Lỗi Login "Unauthorized" trên Web UI
Do Vercel là môi trường Serverless (không lưu trạng thái file), bạn **phải** cấu hình biến môi trường:
- `WEB_UI_PASSWORD`: Mật khẩu đăng nhập (ví dụ: `tsondeptrai99`).

Nếu không cấu hình, mật khẩu mặc định sẽ là `admin123`.
