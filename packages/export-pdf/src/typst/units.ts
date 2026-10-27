export const num = (n: number): string => String(Math.round(n * 1000) / 1000);
export const em = (n: number): string => `${num(n)}em`;
export const inch = (n: number): string => `${num(n)}in`;
