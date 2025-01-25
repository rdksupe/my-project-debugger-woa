# My Project Debugger

A CLI tool for analyzing code and errors using LLM (Language Model) capabilities, with a Godspeed backend for handling LLM integration.

## Project Structure

- `frontend/` - CLI application written in TypeScript
- `backend/` - Godspeed server with LLM integration

## Setup

### Backend Setup

1. Navigate to the backend directory:
```sh
cd backend
npm install 
godspeed serve
```

2. Ensure you have `tokenjs.yaml` configured for your datasource.

3. Configure your LLM settings as per token.js docs:
```yaml
type: tokenjs
config:
  provider: "your-provider"
  model: "your-model"
```
Like for example for using a model from ollama you would use the following config : 

```
type: tokenjs
config:
  provider: openai-compatible
  baseURL: http://localhost:11434/v1
  models:
    - name: <name of your model>
      config:
        temperature: 0.7
        max_tokens: 1000

```
For more information you can check tokenjs docs regarding this here https://docs.tokenjs.ai/providers

### Frontend Setup

1. Navigate to the frontend directory:
```sh
cd frontend
npm install
npm run build
```


2. You can now access the CLI tool by running:
```sh
code-help
```


