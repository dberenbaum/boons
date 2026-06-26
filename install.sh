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

ensure_boons_on_path() {
  local bin_dir="$HOME/.local/bin"
  local boons_bin="$INSTALL_DIR/bin/boons"
  local link_path="$bin_dir/boons"

  mkdir -p "$bin_dir"
  ln -sf "$boons_bin" "$link_path"

  # Remove any legacy boons/bin PATH entries from shell configs
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.config/fish/config.fish"; do
    if [ -f "$rc" ] && grep -q 'boons/bin' "$rc" 2>/dev/null; then
      local tmp
      tmp=$(grep -v 'boons/bin' "$rc" 2>/dev/null) || true
      printf '%s\n' "$tmp" > "$rc"
      echo "==> Removed old boons PATH entry from $rc"
    fi
  done

  # Check if ~/.local/bin is already on PATH
  case ":$PATH:" in
    *:"$bin_dir":*) return 0 ;;
  esac

  # Not on PATH — add to shell config
  local rc_file=""
  case "${SHELL:-}" in
    *zsh) rc_file="$HOME/.zshrc" ;;
    *bash) rc_file="$HOME/.bashrc" ;;
    *fish) rc_file="$HOME/.config/fish/config.fish" ;;
  esac

  if [ -n "$rc_file" ]; then
    if grep -qF "$bin_dir" "$rc_file" 2>/dev/null; then
      return 0
    fi
    echo "" >> "$rc_file"
    echo "# boons" >> "$rc_file"
    echo "export PATH=\"\$PATH:$bin_dir\"" >> "$rc_file"
    echo "==> Added $bin_dir to PATH in $rc_file"
  else
    echo "==> Unknown shell. Add $bin_dir to your PATH manually."
  fi
}

ensure_boons_on_path

echo ""
echo "  Boons installed to $INSTALL_DIR"
echo "  Linked $HOME/.local/bin/boons"
echo ""
if case ":$PATH:" in *:"$HOME/.local/bin":*) true;; *) false;; esac; then
  echo "  Run 'boons install' to get started."
else
  echo "  Restart your shell or run:"
  echo ""
  echo "    export PATH=\"\$PATH:$HOME/.local/bin\""
  echo ""
  echo "  Then run 'boons install' to get started."
fi
echo ""
echo "  Then use session-save, session-push, and session-pull"
echo "  from inside your agent."
echo ""
