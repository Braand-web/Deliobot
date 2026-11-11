# Deliobot

Deliobot is a chat app for running a team of AI agents: every bot in the
sidebar is a real agent with its own model, its own computer and its own
connected apps.

## Origin and license

Deliobot is built on [OpenMausBot](https://github.com/milind-soni/OpenMausBot),
used under the [Apache License 2.0](LICENSE). The upstream copyright and
third-party notices are kept in [NOTICE](NOTICE) and [`third_party/`](third_party/).

This repository contains the open-source edition only: the upstream
`enterprise/` folder is under a separate, non-redistributable license and is
not included. The OpenMausBot and MausBot names and mascot are trademarks of
their owner; Deliobot is replacing them with its own brand.

The upstream README is kept for reference in
[`docs/UPSTREAM-README.md`](docs/UPSTREAM-README.md).

## Development

Requires Node.js 24 and pnpm 10.

```bash
pnpm install
```

```bash
pnpm dev:server
```

```bash
pnpm dev
```
