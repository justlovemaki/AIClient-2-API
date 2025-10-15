# Droid (Factory.ai) Provider

This adapter enables you to use Factory.ai's Droid CLI as an OpenAI-compatible API through AIClient2API.

## Features

- ✅ Uses your existing Droid CLI installation
- ✅ No need for API keys or token management
- ✅ Full Claude API compatibility
- ✅ Supports streaming and non-streaming responses
- ✅ Works with any OpenAI-compatible client

## Prerequisites

1. **Install Droid CLI**
   ```bash
   # Install Droid CLI from Factory.ai
   # Visit: https://factory.ai/product/cli
   ```

2. **Authenticate with Droid**
   ```bash
   droid
   # Follow the prompts to login
   ```

## Configuration

### Using Command Line Arguments

```bash
node src/api-server.js \
  --model-provider droid-factory-oauth \
  --port 3000 \
  --api-key your-api-key
```

### Using config.json

Add to your `config.json`:

```json
{
  "MODEL_PROVIDER": "droid-factory-oauth",
  "PORT": 3000,
  "API_KEY": "your-api-key"
}
```

### Using Environment Variables

```bash
export MODEL_PROVIDER=droid-factory-oauth
export PORT=3000
export API_KEY=your-api-key
node src/api-server.js
```

## Usage

### With OpenAI-Compatible Clients

Point your OpenAI-compatible client to the proxy:

```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="your-api-key"
)

response = client.chat.completions.create(
    model="claude-sonnet-4-5-20250929",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)
```

### With Claude SDK

```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:3000",
    api_key="your-api-key"  # Your proxy API key, not Anthropic's
)

message = client.messages.create(
    model="claude-sonnet-4-5-20250929",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Hello, Claude!"}
    ]
)
```

### With curl

```bash
# Claude API format
curl http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'

# OpenAI API format
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

## Supported Models

The Droid provider supports all Claude models available through Factory.ai:

- `claude-sonnet-4-5-20250929` (default)
- `claude-3-7-sonnet-20250219`
- `claude-3-5-sonnet-20241022`
- `claude-3-opus-20240229`

## How It Works

The proxy converts OpenAI/Claude API requests into `droid exec` commands and streams the results back:

1. Your app sends a request to the proxy (OpenAI or Claude format)
2. The proxy converts messages to a prompt
3. Executes `droid exec "your prompt"`
4. Streams the response back in the requested format

## Troubleshooting

### "Droid CLI is not installed or not in PATH"

**Problem**: The droid command is not available

**Solution**:
1. Install Droid CLI from https://factory.ai/product/cli
2. Make sure `droid` is in your system PATH
3. Test with: `droid --version`

### "Droid command failed"

**Problem**: Droid CLI returned an error

**Solution**:
1. Make sure you are authenticated: `droid`
2. Test droid directly: `droid exec "hello"`
3. Check for any error messages from the droid CLI

### Authentication Issues

**Problem**: Droid needs authentication

**Solution**:
1. Run `droid` to start an interactive session and authenticate
2. Follow the browser authentication flow
3. After authentication, the proxy will work automatically

## Architecture

```
Your App → AIClient2API Proxy → droid exec command → Factory.ai
         (Port 3000)            (CLI process)
```

The Droid provider:
1. Receives API requests (OpenAI or Claude format)
2. Converts messages to prompt text
3. Spawns `droid exec "prompt"` process
4. Streams output back to client
5. Converts response to requested API format

## Advanced Configuration

### Custom Droid Command

If your droid CLI is installed with a different name or path:

```json
{
  "MODEL_PROVIDER": "droid-factory-oauth",
  "DROID_COMMAND": "/custom/path/to/droid"
}
```

## Security Considerations

1. **API key protection**: Use strong API keys for the proxy itself
2. **Local execution**: Droid CLI runs locally with your credentials
3. **Use HTTPS in production**: Don't expose the proxy over HTTP in production
4. **Access control**: Limit who can access your proxy server

## Limitations

- Requires Droid CLI to be installed and authenticated
- Each request spawns a new `droid exec` process
- Streaming support depends on droid CLI output behavior
- Authentication is managed by Droid CLI (not the proxy)

## Contributing

When contributing Droid-related changes:

1. Test with actual Droid CLI installation
2. Ensure both streaming and non-streaming work
3. Update this README with any new features
4. Follow the existing code patterns in the project

## License

This provider follows the same license as the main AIClient2API project (GPLv3).
