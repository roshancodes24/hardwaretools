declare global {
  namespace Express {
    interface Request {
      /** Populated by `validateBody` middleware after successful parse */
      validatedBody?: unknown;
    }
  }
}

export {};
