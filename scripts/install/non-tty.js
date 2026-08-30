export function assertInteractiveOrYes({ isTTY, yesFlag }) {
  if (isTTY || yesFlag) return
  process.stderr.write(
    'Error: Interactive installer requires a terminal.\n\n' +
    'For automated installs:\n' +
    '  npx @penggin/gsd-pi-herdr@latest --yes\n\n' +
    'Or install directly:\n' +
    '  npm install -g @penggin/gsd-pi-herdr\n\n',
  )
  process.exit(1)
}

export function printNonInteractiveNextSteps() {
  process.stdout.write(
    '\nInstalled. Run:\n' +
    '  gsd config   # configure LLM provider\n' +
    '  gsd          # start agent\n\n' +
    'Docs: https://github.com/penggin/gsd-pi-herdr\n\n',
  )
}
