import type { ExecutionTrace, TraceVariable } from '../types/trace'

const variable = (
  id: string,
  name: string,
  value: number,
): TraceVariable => ({
  id,
  name,
  type: 'int',
  value,
  scope: 'main',
})

const frame = (variables: string[]) => [
  { id: 'frame:main:1', function: 'main', variables },
]

export const starterCode = `#include <stdio.h>

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
}`

export const mockTrace: ExecutionTrace = {
  schemaVersion: '1.0',
  runId: 'run_demo_001',
  status: 'completed',
  source: {
    entryFile: 'main.c',
    language: 'c',
  },
  trace: [
    {
      step: 0,
      location: { file: 'main.c', line: 3, column: 1 },
      event: { type: 'function_enter', data: { function: 'main' } },
      state: { variables: [], callStack: frame([]), memory: [] },
      output: { stdout: '', stderr: '' },
    },
    {
      step: 1,
      location: { file: 'main.c', line: 4, column: 5 },
      event: { type: 'declare', data: { variableId: 'main:i' } },
      state: {
        variables: [variable('main:i', 'i', 0)],
        callStack: frame(['main:i']),
        memory: [],
      },
      output: { stdout: '', stderr: '' },
    },
    {
      step: 2,
      location: { file: 'main.c', line: 5, column: 5 },
      event: { type: 'declare', data: { variableId: 'main:sum' } },
      state: {
        variables: [variable('main:i', 'i', 0), variable('main:sum', 'sum', 0)],
        callStack: frame(['main:i', 'main:sum']),
        memory: [],
      },
      output: { stdout: '', stderr: '' },
    },
    {
      step: 3,
      location: { file: 'main.c', line: 7, column: 10 },
      event: {
        type: 'assign',
        data: { variableId: 'main:i', oldValue: 0, newValue: 1 },
      },
      state: {
        variables: [variable('main:i', 'i', 1), variable('main:sum', 'sum', 0)],
        callStack: frame(['main:i', 'main:sum']),
        memory: [],
      },
      output: { stdout: '', stderr: '' },
    },
    {
      step: 4,
      location: { file: 'main.c', line: 8, column: 9 },
      event: {
        type: 'assign',
        data: { variableId: 'main:sum', oldValue: 0, newValue: 1 },
      },
      state: {
        variables: [variable('main:i', 'i', 1), variable('main:sum', 'sum', 1)],
        callStack: frame(['main:i', 'main:sum']),
        memory: [],
      },
      output: { stdout: '', stderr: '' },
    },
    {
      step: 5,
      location: { file: 'main.c', line: 8, column: 9 },
      event: {
        type: 'assign',
        data: { variableId: 'main:sum', oldValue: 1, newValue: 3 },
      },
      state: {
        variables: [variable('main:i', 'i', 2), variable('main:sum', 'sum', 3)],
        callStack: frame(['main:i', 'main:sum']),
        memory: [],
      },
      output: { stdout: '', stderr: '' },
    },
    {
      step: 6,
      location: { file: 'main.c', line: 8, column: 9 },
      event: {
        type: 'assign',
        data: { variableId: 'main:sum', oldValue: 3, newValue: 6 },
      },
      state: {
        variables: [variable('main:i', 'i', 3), variable('main:sum', 'sum', 6)],
        callStack: frame(['main:i', 'main:sum']),
        memory: [],
      },
      output: { stdout: '', stderr: '' },
    },
    {
      step: 7,
      location: { file: 'main.c', line: 11, column: 5 },
      event: { type: 'output', data: { text: 'sum = 6\n' } },
      state: {
        variables: [variable('main:i', 'i', 4), variable('main:sum', 'sum', 6)],
        callStack: frame(['main:i', 'main:sum']),
        memory: [],
      },
      output: { stdout: 'sum = 6\n', stderr: '' },
    },
    {
      step: 8,
      location: { file: 'main.c', line: 12, column: 5 },
      event: { type: 'return', data: { value: 0 } },
      state: {
        variables: [variable('main:i', 'i', 4), variable('main:sum', 'sum', 6)],
        callStack: frame(['main:i', 'main:sum']),
        memory: [],
      },
      output: { stdout: 'sum = 6\n', stderr: '' },
    },
  ],
  summary: {
    totalSteps: 9,
    exitCode: 0,
    truncated: false,
  },
  error: null,
}
