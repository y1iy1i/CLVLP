#define _GNU_SOURCE

#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

void *__real_malloc(size_t size);
void *__real_calloc(size_t count, size_t size);
void *__real_realloc(void *pointer, size_t size);
void __real_free(void *pointer);

static int logging_event = 0;

static void log_memory_event(
    const char *operation,
    const void *address,
    size_t size,
    const void *previous_address
) {
    char buffer[192];
    int descriptor;
    int length;

    if (logging_event) {
        return;
    }
    logging_event = 1;
    descriptor = open(
        "/tmp/clvlp-trace.memory",
        O_WRONLY | O_CREAT | O_APPEND,
        0600
    );
    if (descriptor >= 0) {
        length = snprintf(
            buffer,
            sizeof(buffer),
            "%s\t%p\t%zu\t%p\n",
            operation,
            address,
            size,
            previous_address
        );
        if (length > 0) {
            size_t output_length = (size_t) length;
            if (output_length >= sizeof(buffer)) {
                output_length = sizeof(buffer) - 1;
            }
            (void) write(descriptor, buffer, output_length);
        }
        close(descriptor);
    }
    logging_event = 0;
}

void *__wrap_malloc(size_t size) {
    void *result = __real_malloc(size);
    log_memory_event("malloc", result, size, NULL);
    return result;
}

void *__wrap_calloc(size_t count, size_t size) {
    void *result = __real_calloc(count, size);
    log_memory_event("calloc", result, count * size, NULL);
    return result;
}

void *__wrap_realloc(void *pointer, size_t size) {
    uintptr_t previous_value = (uintptr_t) pointer;
    void *result = __real_realloc(pointer, size);
    log_memory_event("realloc", result, size, (void *) previous_value);
    return result;
}

void __wrap_free(void *pointer) {
    uintptr_t previous_value = (uintptr_t) pointer;
    __real_free(pointer);
    log_memory_event("free", (void *) previous_value, 0, NULL);
}
