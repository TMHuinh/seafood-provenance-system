const BASE_API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
const TOKEN_KEY = 'seafood_provenance_token'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token)
  } else {
    localStorage.removeItem(TOKEN_KEY)
  }
}

export const AUTH_UNAUTHORIZED_EVENT = 'auth:unauthorized'

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  auth?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (auth) {
    const token = getToken()
    if (!token) {
      throw new ApiError('Vui lòng đăng nhập để tiếp tục', 401)
    }
    headers.Authorization = `Bearer ${token}`
  }

  let response: Response
  try {
    const urlPath = path.startsWith('/') ? path : `/${path}`
    response = await fetch(`${BASE_API_URL}/api${urlPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Không thể kết nối tới máy chủ. Vui lòng thử lại', 0)
  }

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    if (response.status === 401) {
      setToken(null)
      window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT))
    }
    throw new ApiError(
      data?.message ?? `Yêu cầu thất bại (mã ${response.status})`,
      response.status,
    )
  }

  return data as T
}

export const api = {
  get: <T>(path: string, auth = true) => request<T>(path, { method: 'GET', auth }),
  post: <T>(path: string, body?: unknown, auth = true) =>
    request<T>(path, { method: 'POST', body, auth }),
}
