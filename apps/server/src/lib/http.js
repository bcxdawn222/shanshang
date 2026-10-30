/** 业务错误：统一返回 { error: { code, message } } */
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(error, request, reply) {
  if (error instanceof HttpError) {
    return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
  }
  if (error.validation) {
    return reply
      .code(400)
      .send({ error: { code: 'BAD_REQUEST', message: '参数不正确', detail: error.message } });
  }
  const status = error.statusCode ?? 500;
  if (status < 500) {
    return reply.code(status).send({ error: { code: error.code || 'BAD_REQUEST', message: error.message } });
  }
  request.log.error(error);
  return reply.code(500).send({ error: { code: 'INTERNAL', message: '服务器错误' } });
}

export function isUniqueViolation(error) {
  return error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || error?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}
