#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/dberenbaum/boons.git"
INSTALL_DIR="${BOONS_DIR:-$HOME/.local/share/boons}"

echo "==> Installing boons..."

if ! command -v bun &>/dev/null; then
  echo "==> Bun not found. Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  echo "==> Bun installed. Restart your shell or add ~/.bun/bin to your PATH."
  echo "    Then re-run this install script."
  exit 0
fi

if [ -d "$INSTALL_DIR" ]; then
  echo "==> Boons already installed at $INSTALL_DIR"
  echo "    Pulling latest..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$INSTALL_DIR"
fi

SHELL_CONFIG=""
case "${SHELL:-}" in
  *zsh) SHELL_CONFIG="$HOME/.zshrc" ;;
  *bash) SHELL_CONFIG="$HOME/.bashrc" ;;
  *fish) SHELL_CONFIG="$HOME/.config/fish/config.fish" ;;
esac

if [ -n "$SHELL_CONFIG" ]; then
  if ! grep -q "boons/bin" "$SHELL_CONFIG" 2>/dev/null; then
    echo "==> Adding boons to PATH in $SHELL_CONFIG"
    echo "" >> "$SHELL_CONFIG"
    echo "# boons" >> "$SHELL_CONFIG"
    echo "export PATH=\"\$PATH:$INSTALL_DIR/bin\"" >> "$SHELL_CONFIG"
  fi
fi

echo ""
echo "  Boons installed to $INSTALL_DIR"
echo "  Restart your shell or run:"
echo ""
echo "    export PATH=\"\$PATH:$INSTALL_DIR/bin\""
echo "    boons install opencode"
echo ""
echo "  Then use session-save, session-push, and session-pull"
echo "  from inside your agent."
echo ""
