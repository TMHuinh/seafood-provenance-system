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

  response.status(error.status ?? 500).json({
    success: false,
    message: error.status ? error.message : 'Internal server error',
  })
}

module.exports = {
  errorHandler,
  notFoundHandler,
}
