const BASE_API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
export const TOKEN_KEY = 'seafood_provenance_token'
let sessionVersion = 0

export class StaleRequestError extends Error {
  constructor() {
    super('Phiên làm việc hoặc dữ liệu đã thay đổi. Vui lòng thử lại.')
    this.name = 'StaleRequestError'
  }
}

export function captureSession(): () => boolean {
  const version = sessionVersion
  const token = getToken()
  return () => version === sessionVersion && token === getToken()
}

export class ApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  sessionVersion++
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
  const sessionCurrent = captureSession()

  const headers: Record<string, string> = {
  }
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData
  if (!multipart) headers['Content-Type'] = 'application/json'

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
      body: body === undefined ? undefined : multipart ? body as FormData : JSON.stringify(body),
    })
  } catch {
    if (auth && !sessionCurrent()) throw new StaleRequestError()
    throw new ApiError('Không thể kết nối tới máy chủ. Vui lòng thử lại', 0)
  }

  const data = await response.json().catch(() => null)
  if (auth && !sessionCurrent()) throw new StaleRequestError()

  if (!response.ok) {
    if (auth && (response.status === 401 || (response.status === 403 && data?.code === 'ACCOUNT_DISABLED'))) {
      setToken(null)
      window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT))
    }
    throw new ApiError(
      data?.message ?? `Yêu cầu thất bại (mã ${response.status})`,
      response.status,
      data?.code,
    )
  }

  return data as T
}

export const api = {
  get: <T>(path: string, auth = true) => request<T>(path, { method: 'GET', auth }),
  post: <T>(path: string, body?: unknown, auth = true) =>
    request<T>(path, { method: 'POST', body, auth }),
  upload: <T>(path: string, body: FormData, auth = true) =>
    request<T>(path, { method: 'POST', body, auth }),
  patch: <T>(path: string, body?: unknown, auth = true) =>
    request<T>(path, { method: 'PATCH', body, auth }),
  delete: <T>(path: string, auth = true) => request<T>(path, { method: 'DELETE', auth }),
}
