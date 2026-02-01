export class TimeoutError extends Error {}

export const promiseTimeout = async <T>(ms: number, promise: Promise<T>): Promise<T> => {
  const timeout = new Promise<T>((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new TimeoutError(`Timed out in ${ms} ms.`));
    }, ms);
  });

  return Promise.race([promise, timeout]);
};
