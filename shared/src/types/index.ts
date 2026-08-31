export type ApiResponse = {
  message: string;
  success: true;
}

export type User = {
  id: string;
  email: string;
  name: string;
}

export type LoginRequest = {
  email: string;
  password: string;
}

/**
 * The refresh token never appears in a response body — it is set as an
 * httpOnly cookie by the server. Only the short-lived access token is
 * handed to the client, which keeps it in memory.
 */
export type AuthResponse = {
  user: User;
  accessToken: string;
  expiresIn: number;
}

export type ErrorResponse = {
  error: string;
}
