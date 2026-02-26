#!/usr/bin/env bash
set -euo pipefail

# MailFeed Setup Script
# macOS-focused: installs prerequisites, clones repo, configures .env, starts Docker

REPO_URL="https://github.com/toothbrush-inc/mailfeed.git"
INSTALL_DIR="$HOME/mailfeed"

# ── Colors ────────────────────────────────────────────────────────────────────
bold="\033[1m"
green="\033[32m"
yellow="\033[33m"
red="\033[31m"
reset="\033[0m"

info()  { echo -e "${bold}==>${reset} $1"; }
ok()    { echo -e "${green}OK${reset}  $1"; }
warn()  { echo -e "${yellow}!!${reset}  $1"; }
fail()  { echo -e "${red}ERR${reset} $1"; exit 1; }

# ── Homebrew ──────────────────────────────────────────────────────────────────
if command -v brew &>/dev/null; then
  ok "Homebrew already installed"
else
  info "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for Apple Silicon
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
fi

# ── Git ───────────────────────────────────────────────────────────────────────
if command -v git &>/dev/null; then
  ok "Git already installed"
else
  info "Installing Git..."
  brew install git
fi

# ── Docker Desktop ────────────────────────────────────────────────────────────
if command -v docker &>/dev/null; then
  ok "Docker already installed"
else
  info "Installing Docker Desktop..."
  brew install --cask docker
fi

# Wait for Docker daemon to be ready
if docker info &>/dev/null; then
  ok "Docker daemon is running"
else
  warn "Docker Desktop is not running."
  info "Opening Docker Desktop — please wait for it to start..."
  open -a Docker 2>/dev/null || true
  echo -n "    Waiting for Docker daemon"
  attempts=0
  while ! docker info &>/dev/null; do
    echo -n "."
    sleep 3
    attempts=$((attempts + 1))
    if [[ $attempts -ge 40 ]]; then
      fail "Docker daemon did not start after 2 minutes. Please open Docker Desktop manually and re-run this script."
    fi
  done
  echo ""
  ok "Docker daemon is running"
fi

# ── Clone Repo ────────────────────────────────────────────────────────────────
# Detect if we're already inside the repo
if [[ -f "docker-compose.yaml" && -f ".env.example" ]]; then
  INSTALL_DIR="$(pwd)"
  ok "Already inside the MailFeed repo at $INSTALL_DIR"
elif [[ -d "$INSTALL_DIR" ]]; then
  ok "MailFeed directory already exists at $INSTALL_DIR"
  cd "$INSTALL_DIR"
else
  info "Cloning MailFeed into $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── Environment File ─────────────────────────────────────────────────────────
if [[ -f ".env" ]]; then
  warn ".env file already exists — skipping copy. Edit it manually if needed."
else
  cp .env.example .env
  ok "Created .env from template"
fi

# Auto-generate NEXTAUTH_SECRET if empty
if grep -q 'NEXTAUTH_SECRET=""' .env; then
  secret=$(openssl rand -base64 32)
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|NEXTAUTH_SECRET=\"\"|NEXTAUTH_SECRET=\"$secret\"|" .env
  else
    sed -i "s|NEXTAUTH_SECRET=\"\"|NEXTAUTH_SECRET=\"$secret\"|" .env
  fi
  ok "Generated NEXTAUTH_SECRET"
fi

# ── Prompt for API Keys ──────────────────────────────────────────────────────
echo ""
echo -e "${bold}You'll need Google OAuth credentials to sign in and sync emails:${reset}"
echo ""
echo "  1. Create a Google Cloud project:  https://console.cloud.google.com/projectcreate"
echo "  2. Enable the Gmail API:           https://console.cloud.google.com/apis/library/gmail.googleapis.com"
echo "  3. Create OAuth credentials:       https://console.cloud.google.com/apis/credentials/oauthclient"
echo "     - Application type: Web application"
echo "     - Redirect URI:     http://localhost:3000/api/auth/callback/google"
echo ""
echo "  Need help? See the setup guide: https://github.com/toothbrush-inc/mailfeed#google-cloud-setup"
echo "  Or after getting the app running: http://localhost:3000/setup/google"
echo ""

prompt_key() {
  local var_name="$1"
  local display_name="$2"

  # Check if already set in .env
  current=$(grep "^${var_name}=" .env | cut -d'"' -f2)
  if [[ -n "$current" ]]; then
    ok "$display_name is already set"
    return
  fi

  read -rp "  $display_name: " value
  if [[ -z "$value" ]]; then
    warn "Skipped $display_name — you can edit .env later"
    return
  fi

  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|${var_name}=\"\"|${var_name}=\"${value}\"|" .env
  else
    sed -i "s|${var_name}=\"\"|${var_name}=\"${value}\"|" .env
  fi
  ok "Saved $display_name"
}

prompt_key "GOOGLE_CLIENT_ID"     "Google Client ID"
prompt_key "GOOGLE_CLIENT_SECRET" "Google Client Secret"

echo ""
echo -e "${bold}(Optional)${reset} Gemini API key enables AI features."
echo "  You can add this later in .env. Get a key at: https://aistudio.google.com/apikey"
echo "  Press Enter to skip"
echo ""
prompt_key "GEMINI_API_KEY"       "Gemini API Key"

# ── Start Docker Compose ─────────────────────────────────────────────────────
echo ""
info "Starting MailFeed with Docker Compose..."
docker compose up --build -d

echo ""
echo -e "${green}${bold}MailFeed is running!${reset}"
echo ""
echo "  Open: http://localhost:3000"
echo ""
echo "  Setup guide: http://localhost:3000/setup/google"
echo ""
echo "  Useful commands:"
echo "    docker compose logs -f     # View logs"
echo "    docker compose down        # Stop"
echo "    docker compose up -d       # Restart"
echo ""
