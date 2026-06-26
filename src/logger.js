const levels = ['debug', 'info', 'warn', 'error'];

export function createLogger(level = 'info') {
  const minimum = levels.includes(level) ? levels.indexOf(level) : levels.indexOf('info');

  function shouldLog(messageLevel) {
    return levels.indexOf(messageLevel) >= minimum;
  }

  function write(messageLevel, message, meta = {}) {
    if (!shouldLog(messageLevel)) {
      return;
    }

    const record = {
      ...meta,
      time: new Date().toISOString(),
      level: messageLevel,
      message
    };

    const output = JSON.stringify(record);
    if (messageLevel === 'error') {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta)
  };
}
