/**
 * Native Linux Executable Launcher for FIRA HuroCup United Soccer GameController (`./GameController`)
 *
 * Starts the embedded [US-21] `0xADDE` UDP Broadcast & Telemetry engine and opens
 * a standalone chromeless desktop application window (no browser tabs or URL bar),
 * terminating the background UDP engine automatically when the window is closed.
 */

#define _GNU_SOURCE
#include <errno.h>
#include <libgen.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static volatile pid_t g_server_pid = -1;
static volatile pid_t g_window_pid = -1;

static void cleanup_children(void) {
    if (g_window_pid > 0) {
        kill(g_window_pid, SIGTERM);
        g_window_pid = -1;
    }
    if (g_server_pid > 0) {
        kill(g_server_pid, SIGTERM);
        waitpid(g_server_pid, NULL, WNOHANG);
        g_server_pid = -1;
    }
}

static void handle_signal(int sig) {
    (void)sig;
    cleanup_children();
    _exit(0);
}

static bool file_is_executable(const char *path) {
    struct stat st;
    return (stat(path, &st) == 0) && S_ISREG(st.st_mode) && (access(path, X_OK) == 0);
}

static const char *find_node_binary(void) {
    static const char *candidates[] = {
        "/home/linuxbrew/.linuxbrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
        NULL
    };
    for (int i = 0; candidates[i] != NULL; ++i) {
        if (file_is_executable(candidates[i])) {
            return candidates[i];
        }
    }
    return "node";
}

static const char *find_chrome_binary(void) {
    static const char *candidates[] = {
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        NULL
    };
    for (int i = 0; candidates[i] != NULL; ++i) {
        if (file_is_executable(candidates[i])) {
            return candidates[i];
        }
    }
    return NULL;
}

static void print_help(const char *prog) {
    printf("FIRA HuroCup United Soccer — GameController [Protocol US-21]\n\n");
    printf("Usage: %s [OPTIONS]\n\n", prog);
    printf("Options:\n");
    printf("  -p, --port <PORT>          UDP broadcast/listen port for 0xADDE packets (default: 3838)\n");
    printf("  -b, --broadcast <IP>       UDP broadcast IPv4 address (default: 255.255.255.255)\n");
    printf("  -f, --fullscreen           Start the GameController window in fullscreen mode\n");
    printf("      --headless             Run only the [US-21] UDP & UI engine without opening a GUI window\n");
    printf("  -h, --help                 Print this help message and exit\n");
}

int main(int argc, char **argv) {
    const char *udp_port = "3838";
    const char *broadcast_ip = "255.255.255.255";
    bool fullscreen = false;
    bool headless = false;

    for (int i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            print_help(argv[0]);
            return 0;
        } else if ((strcmp(argv[i], "-p") == 0 || strcmp(argv[i], "--port") == 0) && i + 1 < argc) {
            udp_port = argv[++i];
        } else if ((strcmp(argv[i], "-b") == 0 || strcmp(argv[i], "--broadcast") == 0) && i + 1 < argc) {
            broadcast_ip = argv[++i];
        } else if (strcmp(argv[i], "-f") == 0 || strcmp(argv[i], "--fullscreen") == 0) {
            fullscreen = true;
        } else if (strcmp(argv[i], "--headless") == 0) {
            headless = true;
        } else {
            fprintf(stderr, "Unknown option: %s (use --help for usage)\n", argv[i]);
            return 1;
        }
    }

    // Resolve executable directory via /proc/self/exe
    char exe_path[PATH_MAX];
    ssize_t len = readlink("/proc/self/exe", exe_path, sizeof(exe_path) - 1);
    if (len < 0) {
        perror("readlink(/proc/self/exe)");
        return 1;
    }
    exe_path[len] = '\0';

    char dir_buf[PATH_MAX];
    strncpy(dir_buf, exe_path, sizeof(dir_buf) - 1);
    dir_buf[sizeof(dir_buf) - 1] = '\0';
    char *exe_dir = dirname(dir_buf);

    // Check if we are in <root>/bin or <root>
    char server_script[PATH_MAX];
    snprintf(server_script, sizeof(server_script), "%s/frontend/app-server.mjs", exe_dir);
    struct stat st;
    if (stat(server_script, &st) != 0) {
        snprintf(server_script, sizeof(server_script), "%s/../frontend/app-server.mjs", exe_dir);
        if (stat(server_script, &st) != 0) {
            fprintf(stderr, "Error: Could not locate frontend/app-server.mjs relative to %s\n", exe_dir);
            return 1;
        }
    }

    atexit(cleanup_children);
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = handle_signal;
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGHUP, &sa, NULL);

    setenv("USOCCER_UDP_PORT", udp_port, 1);
    setenv("USOCCER_BROADCAST_IP", broadcast_ip, 1);

    int pipefd[2];
    if (pipe(pipefd) != 0) {
        perror("pipe");
        return 1;
    }

    const char *node_bin = find_node_binary();

    pid_t pid = fork();
    if (pid < 0) {
        perror("fork");
        return 1;
    }

    if (pid == 0) {
        // Child: run node frontend/app-server.mjs
        close(pipefd[0]);
        dup2(pipefd[1], STDOUT_FILENO);
        close(pipefd[1]);
        execlp(node_bin, node_bin, server_script, (char *)NULL);
        perror("execlp(node)");
        _exit(127);
    }

    g_server_pid = pid;
    close(pipefd[1]);

    // Read READY_URL=http://127.0.0.1:<port> from server stdout
    char ready_url[256] = {0};
    FILE *fp = fdopen(pipefd[0], "r");
    if (!fp) {
        perror("fdopen");
        cleanup_children();
        return 1;
    }

    char line[512];
    while (fgets(line, sizeof(line), fp) != NULL) {
        if (strncmp(line, "READY_URL=", 10) == 0) {
            char *val = line + 10;
            size_t l = strlen(val);
            while (l > 0 && (val[l - 1] == '\n' || val[l - 1] == '\r')) {
                val[--l] = '\0';
            }
            snprintf(ready_url, sizeof(ready_url), "%s", val);
            break;
        }
    }
    fclose(fp);

    if (ready_url[0] == '\0') {
        fprintf(stderr, "Error: Failed to start FIRA United Soccer GameController backend engine.\n");
        cleanup_children();
        return 1;
    }

    fprintf(stderr, "[FIRA United Soccer GameController] UDP [US-21] 0xADDE active on %s:%s\n", broadcast_ip, udp_port);
    fprintf(stderr, "[FIRA United Soccer GameController] Application runtime bound at %s\n", ready_url);

    if (headless) {
        int status = 0;
        waitpid(g_server_pid, &status, 0);
        return 0;
    }

    const char *chrome_bin = find_chrome_binary();
    if (chrome_bin != NULL) {
        char app_arg[320];
        snprintf(app_arg, sizeof(app_arg), "--app=%s", ready_url);

        char profile_arg[256];
        snprintf(profile_arg, sizeof(profile_arg), "--user-data-dir=/tmp/fira-usoccer-gc-app-%u", (unsigned)getuid());

        pid_t wpid = fork();
        if (wpid == 0) {
            // Suppress noisy browser stderr logs so terminal stays clean like RoboCup GameController
            FILE *devnull = fopen("/dev/null", "w");
            if (devnull) {
                dup2(fileno(devnull), STDERR_FILENO);
                dup2(fileno(devnull), STDOUT_FILENO);
                fclose(devnull);
            }
            if (fullscreen) {
                execl(
                    chrome_bin,
                    chrome_bin,
                    profile_arg,
                    app_arg,
                    "--start-fullscreen",
                    "--class=FIRAUnitedSoccerGameController",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-extensions",
                    (char *)NULL
                );
            } else {
                execl(
                    chrome_bin,
                    chrome_bin,
                    profile_arg,
                    app_arg,
                    "--window-size=1440,900",
                    "--class=FIRAUnitedSoccerGameController",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-extensions",
                    (char *)NULL
                );
            }
            _exit(127);
        } else if (wpid > 0) {
            g_window_pid = wpid;
            int wstatus = 0;
            waitpid(wpid, &wstatus, 0);
            g_window_pid = -1;
            cleanup_children();
            return 0;
        }
    }

    // Fallback if Chrome/Chromium is not installed: keep server running
    fprintf(stderr, "Open %s in your desktop viewer. Press Ctrl+C to stop.\n", ready_url);
    int status = 0;
    waitpid(g_server_pid, &status, 0);
    return 0;
}
