#include <stdio.h>

static int add_one(int value) {
    int result = value + 1;
    return result;
}

int main(void) {
    int counter = 2;
    int total = add_one(counter);
    printf("total=%d\n", total);
    return 0;
}
