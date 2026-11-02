#!/usr/bin/env bash
set -euo pipefail

# Package FIRA HuroCup United Soccer GameController for distribution
VERSION="1.0.0"
DIST_DIR="releases"
TAR_NAME="UnitedSoccerGameController-v${VERSION}-linux-x86_64.tar.gz"

echo "Building production frontend bundle..."
cd frontend
export PATH="/home/linuxbrew/.linuxbrew/bin:$PATH"
npm run build
cd ..

echo "Compiling native launcher binary..."
gcc -O2 -Wall -Wextra -Werror usoccer_app/src/native_launcher.c -o GameController
cp GameController UnitedSoccerGameController

echo "Packaging into ${DIST_DIR}/${TAR_NAME}..."
mkdir -p "${DIST_DIR}"
tar -czvf "${DIST_DIR}/${TAR_NAME}" \
  GameController \
  UnitedSoccerGameController \
  config/ \
  frontend/build/ \
  frontend/app-server.mjs \
  frontend/server-utils.mjs \
  README.md

echo "Done! Archive created at ${DIST_DIR}/${TAR_NAME}"
