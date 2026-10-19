import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { numberMap } from '../lib/taskNumbers';
import type { Task } from '../lib/types';

const NumbersContext = createContext<Map<string, number>>(new Map());

/** Makes the live task numbers available to every row that shows a task. */
export function TaskNumbersProvider({ tasks, children }: { tasks: Task[]; children: ReactNode }) {
  const numbers = useMemo(() => numberMap(tasks), [tasks]);
  return <NumbersContext.Provider value={numbers}>{children}</NumbersContext.Provider>;
}

export const useTaskNumber = (id: string | undefined): number | undefined => {
  const numbers = useContext(NumbersContext);
  return id ? numbers.get(id) : undefined;
};
