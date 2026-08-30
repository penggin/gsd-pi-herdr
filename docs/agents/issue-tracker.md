# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues on **`penggin/gsd-pi-herdr`**. Use the `gh` CLI for all operations.

Always pass `-R penggin/gsd-pi-herdr` so commands cannot auto-resolve to a source-project remote or another checkout.

## Conventions

- **Create an issue**: `gh issue create -R penggin/gsd-pi-herdr --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> -R penggin/gsd-pi-herdr --json number,title,body,labels,comments --jq '{number, title, body, labels: [.labels[].name], comments: [.comments[].body]}'`.
- **List issues**: `gh issue list -R penggin/gsd-pi-herdr --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> -R penggin/gsd-pi-herdr --body "..."`
- **Apply / remove labels**: `gh issue edit <number> -R penggin/gsd-pi-herdr --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> -R penggin/gsd-pi-herdr --comment "..."`

## When a skill says "publish to the issue tracker"

Create a GitHub issue on `penggin/gsd-pi-herdr`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> -R penggin/gsd-pi-herdr --comments`.
