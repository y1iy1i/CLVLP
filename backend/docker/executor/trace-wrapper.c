#define _POSIX_C_SOURCE 200809L

#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static int redirect_descriptor(int target, const char *path, int flags) {
    int descriptor = open(path, flags, 0600);
    if (descriptor < 0) {
        return -1;
    }
    if (dup2(descriptor, target) < 0) {
        close(descriptor);
        return -1;
    }
    close(descriptor);
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        return 126;
    }

    if (redirect_descriptor(STDIN_FILENO, "/dev/null", O_RDONLY) < 0 ||
        redirect_descriptor(
            STDOUT_FILENO,
            "/tmp/clvlp-trace.stdout",
            O_WRONLY | O_CREAT | O_TRUNC
        ) < 0 ||
        redirect_descriptor(
            STDERR_FILENO,
            "/tmp/clvlp-trace.stderr",
            O_WRONLY | O_CREAT | O_TRUNC
        ) < 0) {
        return 126;
    }

    setenv("LD_PRELOAD", "/usr/libexec/coreutils/libstdbuf.so", 1);
    setenv("_STDBUF_O", "0", 1);
    setenv("_STDBUF_E", "0", 1);

    execvp(argv[1], &argv[1]);
    dprintf(STDERR_FILENO, "Unable to start traced program.\n");
    return 127;
}
