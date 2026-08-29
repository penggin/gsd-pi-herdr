# GSD Workers Herdr plugin

This optional Herdr v0.8.2 plugin is the operations surface for GSD-owned worker panes. It never launches subagents or decides retry, chain, parallelism, isolation, or result semantics.

Link it from a source checkout:

```bash
herdr plugin link /absolute/path/to/gsd-pi/integrations/herdr/plugin
herdr plugin action list --plugin opengsd.gsd-workers
```

Available actions show worker status, focus the worker tab or newest failed worker, and request safe release of retained terminal workers. The dashboard is available through:

```bash
herdr plugin pane open --plugin opengsd.gsd-workers --entrypoint dashboard
```

The plugin reads `${GSD_HOME:-~/.gsd}/runtime/herdr/v1`, uses `session.snapshot` for live topology, and writes only owner-only cleanup/reconciliation evidence inside GSD-owned worker directories. It does not remove live or ambiguous worker evidence.

