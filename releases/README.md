# Precompiled Standalone Releases

This folder contains precompiled distributions of the **FIRA HuroCup United Soccer GameController**.

## Linux x86_64 Distribution (`v1.0.0`)

Archive: [`UnitedSoccerGameController-v1.0.0-linux-x86_64.tar.gz`](./UnitedSoccerGameController-v1.0.0-linux-x86_64.tar.gz)

### Contents
- `GameController` (Native 64-bit Linux ELF standalone launcher executable)
- `UnitedSoccerGameController` (Symlink / alias binary)
- `config/` (`settings.yaml` and `teams.yaml`)
- `frontend/` (Embedded production server and pre-built UI assets)

### Quick Run
```bash
# Extract
tar -xzvf UnitedSoccerGameController-v1.0.0-linux-x86_64.tar.gz

# Launch standalone GUI
./GameController

# Or launch with custom options
./GameController --port 3838 --broadcast 255.255.255.255
```

### GitHub Releases
Release archives are also attached as downloadable release assets at:
https://github.com/fajrdev/UnitedSoccer-GameController/releases
