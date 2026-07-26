import fs from 'node:fs';
import path from 'node:path';

const CGROUP_ROOT = '/sys/fs/cgroup';

function currentCgroupPath(readFile) {
  const entry = readFile('/proc/self/cgroup', 'utf8')
    .split(/\r?\n/)
    .find((line) => line.startsWith('0::'));
  return entry ? entry.slice(3) : undefined;
}

export function applyCpuLimit(pid, cpuLimit, logger, io = fs) {
  if (Number.isInteger(cpuLimit)) {
    return { enforced: true, cleanup() {} };
  }
  let groupPath;
  try {
    const relativeGroup = currentCgroupPath(io.readFileSync.bind(io));
    if (relativeGroup === undefined || !io.existsSync(path.join(CGROUP_ROOT, 'cgroup.controllers'))) {
      throw new Error('cgroup v2 is unavailable');
    }
    groupPath = path.join(CGROUP_ROOT, relativeGroup, `s12ryt-vm-${pid}`);
    io.mkdirSync(groupPath);
    const period = 100000;
    io.writeFileSync(path.join(groupPath, 'cpu.max'), `${Math.round(cpuLimit * period)} ${period}\n`);
    io.writeFileSync(path.join(groupPath, 'cgroup.procs'), `${pid}\n`);
    logger.info('VM fractional CPU limit enforced through cgroup v2', { cpuLimit });
    return {
      enforced: true,
      cleanup() {
        try {
          io.rmdirSync(groupPath);
        } catch {}
      }
    };
  } catch (error) {
    if (groupPath) {
      try {
        io.rmdirSync(groupPath);
      } catch {}
    }
    logger.warn('Fractional VM CPU limit could not be enforced; falling back to rounded-up vCPU count', {
      cpuLimit,
      vcpus: Math.ceil(cpuLimit),
      error: error.message
    });
    return { enforced: false, cleanup() {} };
  }
}
