function notFoundHandler(request, response) {
  response.status(404).json({
    success: false,
    message: `Route ${request.method} ${request.originalUrl} was not found`,
  })
}

function errorHandler(error, request, response, next) {
  void request
  void next

  console.error(error)

  const exposeDetails = process.env.NODE_ENV !== 'production'
  response.status(error.status ?? 500).json({
    success: false,
    message: error.status || exposeDetails ? error.message : 'Internal server error',
    ...(exposeDetails && error.code ? { code: error.code } : {}),
  })
}

module.exports = {
  errorHandler,
  notFoundHandler,
}
