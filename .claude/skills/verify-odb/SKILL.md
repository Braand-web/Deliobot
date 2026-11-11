---
name: verify-odb
description: "Verify OpenDeliobot server and conversation changes against an isolated fake-engine instance before claiming they work."
---

# Verify OpenDeliobot

Follow the canonical instructions in `docs/verification/README.md`. Use its
shared control tool; do not improvise raw API calls or drive the user's live
OpenDeliobot instance. The canonical feature map currently covers only the
server flows that tool can prove.
