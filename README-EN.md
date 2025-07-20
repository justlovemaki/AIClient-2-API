# GeminiCli2API
<div align="center">
This project contains two Node.js HTTP servers. They act as local proxies for the Google Cloud Code Assist API. One of the servers also provides an OpenAI API compatible interface. This allows you to bypass the terminal interface and integrate with any client through an API.

[中文](./README.md) / [English](./README-EN.md)
</div>

## Project Overview

-   `gemini-api-server.js`: This is a standalone Node.js HTTP server. It acts as a local proxy for the Google Cloud Code Assist API. This server provides all features and bug fixes. It is designed to be robust and flexible. With a fully controllable logging system, it is easy to monitor.
-   `openai-api-server.js`: This script is based on `gemini-api-server.js`. It creates a standalone Node.js HTTP server. This server is also a local proxy for the Google Cloud Code Assist API. However, it provides an OpenAI API compatible interface. Therefore, any client that supports the OpenAI API can use it directly.
-   `gemini-core.js`: This file contains the core logic shared by both servers. For example, authentication, API calls, request/response handling, and logging functions.

## Feature Description

### Problems Solved

-   Solves the problem of reduced free quotas for the official Gemini API. Now, users can authorize with their Gemini CLI account to make 1000 requests per day.
-   Provides compatibility with the OpenAI API, making it convenient for existing OpenAI clients to use.

### Current Limitations

-   Cannot use the built-in functions of the original Gemini CLI.
-   Does not support multimodal capabilities. (todo)

## Main Features

### Gemini API Server (`gemini-api-server.js`)

-   **Automatic Authentication and Token Renewal**: On the first run, the script guides the user to complete Google account manual authorization through a browser. It will obtain an OAuth token. This token is securely stored locally and automatically refreshed before it expires. This ensures the continuous operation of the service without manual intervention.
-   **Manual Authorization Flow**:
    1.  **Copy Authorization Link**: The terminal will output a Google authorization URL. Please copy this URL.
    2.  **Open the Link in a Browser**: Open the URL in a browser on any device with a graphical interface (e.g., your local computer).
    3.  **Complete Authorization**: Log in to your Google account and grant permissions.
    4.  **Copy the Redirected URL**: After authorization, the browser will attempt to redirect to a URL, extract the authorization code, complete authentication, and start the service normally.
-   **Flexible API Key Validation**: Users can provide the key in the URL query parameter (`?key=...`) or the `x-goog-api-key` request header. As long as the key is correct, the request can be authorized. The key can be set via the `--api-key` startup parameter.
-   **Role Normalization Fix**: The server automatically adds the necessary 'user'/'model' roles to the request body. At the same time, it correctly preserves `systemInstruction` (or `system_instruction`).
-   **Fixed Model List**: The server specifically provides and uses the `gemini-1.5-pro-latest` and `gemini-1.5-flash-latest` models.
-   **Full Gemini API Endpoint Support**: Implements `listModels`, `generateContent`, `streamGenerateContent`.
-   **Fully Controllable Logging System**: Includes the remaining validity period of the token. It can output timestamped prompt logs to the console or a file. Supports log printing.

### OpenAI Compatible API Server (`openai-api-server.js`)

-   **OpenAI API Compatibility**: Implements the `/v1/models` and `/v1/chat/completions` endpoints.
-   **Format Conversion**: Automatically converts requests/responses between OpenAI format and the internal Gemini format.
-   **Streaming Support**: Fully supports OpenAI's streaming responses (`"stream": true`).
-   **Flexible Authentication**: Supports API key validation through the `Authorization: Bearer <key>` request header, URL query parameters (`?key=...`), or the `x-goog-api-key` request header.
-   **Configurability**: The listening address, port, API key, and prompt logging mode can be configured via command-line arguments.
-   **Reuses Core Logic**: The underlying communication with Google services still uses `gemini-core.js`.

## Installation

1.  **Environment Setup**:
    Create a `package.json` file in the project root directory with the content: `{"type": "module"}`. This is to avoid module type warnings.
    (This project already provides a `package.json` file, no need to create it manually)

2.  **Install Dependencies**:
    ```bash
    npm install
    ```
    This will install `google-auth-library` and `uuid`.

## Usage Instructions and Command Line Examples

### 1. Gemini API Server (`gemini-api-server.js`)

**Start the service** (the following parameters can be combined):

-   **Default start**: Listen on `localhost:3000`, do not print prompts
    ```bash
    node gemini-api-server.js
    ```
-   **Specify listening IP**: Listen on all network interfaces (e.g., for Docker or LAN access)
    ```bash
    node gemini-api-server.js 0.0.0.0
    ```
-   **Print prompts to console**: Listen on `localhost` and output prompt details to the console
    ```bash
    node gemini-api-server.js --log-prompts console
    ```
-   **Print prompts to file**: Listen on `localhost` and save prompt details to a new file with a startup timestamp (e.g., `prompts-20231027-153055.log`)
    ```bash
    node gemini-api-server.js --log-prompts file
    ```
-   **Combine parameters** (parameter order does not matter):
    -   Run on a specified IP and print prompts to the console
        ```bash
        node gemini-api-server.js 192.168.1.100 --log-prompts console
        ```
    -   Run on all network interfaces and print prompts to a file
        ```bash
        node gemini-api-server.js --log-prompts file 0.0.0.0
        ```
    -   Specify API Key and port
        ```bash
        node gemini-api-server.js --api-key your_secret_key --port 3001
        ```

**Call API Endpoints** (Default API Key: `123456`):

-   **a) List available models** (GET request, key in URL parameter)
    ```bash
    curl "http://localhost:3000/v1beta/models?key=123456"
    ```
-   **b) Generate content - single turn conversation** (POST request, key in request header)
    ```bash
    curl "http://localhost:3000/v1beta/models/gemini-1.5-pro-latest:generateContent" \
      -H "Content-Type: application/json" \
      -H "x-goog-api-key: 123456" \
      -d '{"contents":[{"parts":[{"text":"Explain what a proxy server is in one sentence"}]}]}'
    ```
-   **c) Generate content - with system prompt** (POST request, key in request header, note `system_instruction`)
    ```bash
    curl "http://localhost:3000/v1beta/models/gemini-1.5-pro-latest:generateContent" \
      -H "Content-Type: application/json" \
      -H "x-goog-api-key: 123456" \
      -d '{
        "system_instruction": { "parts": [{ "text": "You are a cat named Neko." }] },
        "contents": [{ "parts": [{ "text": "Hello, what is your name?" }] }]
      }'
    ```
-   **d) Stream generate content** (POST request, key in URL parameter)
    ```bash
    curl "http://localhost:3000/v1beta/models/gemini-1.5-flash-latest:streamGenerateContent?key=123456" \
      -H "Content-Type: application/json" \
      -d '{"contents":[{"parts":[{"text":"Write a five-line poem about the universe"}]}]}'
    ```

### 2. OpenAI Compatible API Server (`openai-api-server.js`)

**Start the service**:

-   **Same as Gemini API Server**:


**Call API Endpoints** (Assuming API Key: `your_secret_key`, service running on `localhost:8000`):

-   **a) List available models**:
    ```bash
    curl http://localhost:8000/v1/models \
      -H "Authorization: Bearer your_secret_key"
    ```
-   **b) Generate content - with system prompt (non-streaming)**:
    ```bash
    curl http://localhost:8000/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer your_secret_key" \
      -d '{
        "model": "gemini-1.5-pro-latest",
        "messages": [
          {"role": "system", "content": "You are a cat named Neko."},
          {"role": "user", "content": "Hello, what is your name?"}
        ]
      }'
    ```
-   **c) Generate content - streaming**:
    ```bash
    curl http://localhost:8000/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer your_secret_key" \
      -d '{
        "model": "gemini-1.5-flash-latest",
        "messages": [
          {"role": "user", "content": "Write a five-line poem about the universe"}
        ],
        "stream": true
      }'
