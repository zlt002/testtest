# Shared Internal Packages

This directory contains internal shared packages used across the accr-ui monorepo. These packages are private workspace packages and are only used inside this project.

## Available Packages

- **utils**: Common utility functions

## Usage

Workspace packages can import shared packages through the workspace protocol:

```json
{
  "dependencies": {
    "@accr-ui/utils": "workspace:*"
  }
}
```

## Development

```bash
pnpm --filter "./shared/*" build
pnpm --filter "./shared/*" dev
pnpm --filter "./shared/*" typecheck
```
