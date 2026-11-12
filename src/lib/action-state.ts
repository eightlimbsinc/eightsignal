export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Optional link to show after success (e.g. created record or duplicate). */
  href?: string;
}
export const initialActionState: ActionState = {};

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}
