export interface CodeExample {
  id: string
  title: string
  fileName: string
  category: '算法' | '线性结构' | '树' | '图' | '内存'
  description: string
  code: string
}

export const codeExamples: CodeExample[] = [
  {
    id: 'bubble-sort',
    title: '冒泡排序',
    fileName: 'bubble_sort.c',
    category: '算法',
    description: '数组比较、交换和双重循环',
    code: `#include <stdio.h>

int main(void) {
    int arr[] = {5, 1, 4, 2, 8};
    int n = sizeof(arr) / sizeof(arr[0]);

    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                int temp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = temp;
            }
        }
    }

    for (int i = 0; i < n; i++) {
        printf("%d ", arr[i]);
    }
    printf("\\n");
    return 0;
}`,
  },
  {
    id: 'linked-list',
    title: '单链表',
    fileName: 'linked_list.c',
    category: '线性结构',
    description: '节点、next 指针和顺序遍历',
    code: `#include <stdio.h>

typedef struct Node {
    int value;
    struct Node *next;
} Node;

int main(void) {
    Node third = {30, NULL};
    Node second = {20, &third};
    Node first = {10, &second};
    Node *head = &first;

    Node *current = head;
    while (current != NULL) {
        printf("%d ", current->value);
        current = current->next;
    }
    printf("\\n");
    return 0;
}`,
  },
  {
    id: 'binary-tree',
    title: '二叉树',
    fileName: 'binary_tree.c',
    category: '树',
    description: 'left/right 指针和递归遍历',
    code: `#include <stdio.h>

typedef struct TreeNode {
    int value;
    struct TreeNode *left;
    struct TreeNode *right;
} TreeNode;

int sum_tree(TreeNode *node) {
    if (node == NULL) {
        return 0;
    }
    return node->value + sum_tree(node->left) + sum_tree(node->right);
}

int main(void) {
    TreeNode n4 = {4, NULL, NULL};
    TreeNode n5 = {5, NULL, NULL};
    TreeNode n2 = {2, &n4, &n5};
    TreeNode n3 = {3, NULL, NULL};
    TreeNode n1 = {1, &n2, &n3};
    TreeNode *root = &n1;

    printf("sum = %d\\n", sum_tree(root));
    return 0;
}`,
  },
  {
    id: 'pointer-graph',
    title: '指针图',
    fileName: 'pointer_graph.c',
    category: '图',
    description: '多条边、共享节点和环',
    code: `#include <stdio.h>

typedef struct GraphNode {
    int id;
    struct GraphNode *neighbors[3];
    int count;
} GraphNode;

int main(void) {
    GraphNode a = {1, {NULL, NULL, NULL}, 2};
    GraphNode b = {2, {NULL, NULL, NULL}, 2};
    GraphNode c = {3, {NULL, NULL, NULL}, 1};
    GraphNode d = {4, {NULL, NULL, NULL}, 1};

    a.neighbors[0] = &b;
    a.neighbors[1] = &c;
    b.neighbors[0] = &c;
    b.neighbors[1] = &d;
    c.neighbors[0] = &a;
    d.neighbors[0] = &d;

    GraphNode *start = &a;
    for (int i = 0; i < start->count; i++) {
        printf("%d -> %d\\n", start->id, start->neighbors[i]->id);
    }
    return 0;
}`,
  },
  {
    id: 'matrix-graph',
    title: '邻接矩阵 BFS',
    fileName: 'matrix_graph.c',
    category: '图',
    description: '二维连续数组、队列和访问状态',
    code: `#include <stdio.h>

#define N 5

int main(void) {
    int graph[N][N] = {
        {0, 1, 1, 0, 0},
        {1, 0, 0, 1, 0},
        {1, 0, 0, 1, 1},
        {0, 1, 1, 0, 1},
        {0, 0, 1, 1, 0}
    };
    int visited[N] = {0};
    int queue[N];
    int front = 0;
    int rear = 0;

    queue[rear++] = 0;
    visited[0] = 1;
    while (front < rear) {
        int current = queue[front++];
        printf("%d ", current);
        for (int next = 0; next < N; next++) {
            if (graph[current][next] && !visited[next]) {
                visited[next] = 1;
                queue[rear++] = next;
            }
        }
    }
    printf("\\n");
    return 0;
}`,
  },
  {
    id: 'heap-memory',
    title: '动态堆数组',
    fileName: 'heap_memory.c',
    category: '内存',
    description: 'malloc、realloc、指针和 free',
    code: `#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int count = 3;
    int *values = malloc((size_t)count * sizeof(int));
    if (values == NULL) {
        return 1;
    }

    for (int i = 0; i < count; i++) {
        values[i] = (i + 1) * 10;
    }

    count = 5;
    int *resized = realloc(values, (size_t)count * sizeof(int));
    if (resized == NULL) {
        free(values);
        return 1;
    }
    values = resized;
    values[3] = 40;
    values[4] = 50;

    for (int i = 0; i < count; i++) {
        printf("%d ", values[i]);
    }
    printf("\\n");
    free(values);
    values = NULL;
    return 0;
}`,
  },
]

export const starterCode = codeExamples[0].code
