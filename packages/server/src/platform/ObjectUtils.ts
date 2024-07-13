export const flattenObject = (
  obj: object,
  prefix: string[] | undefined = [],
  acc: object | undefined = {}
): { [key: string]: any } => {
  if (typeof obj !== 'object') {
    return obj;
  }
  return Object.entries(obj).reduce((acc, [key, value]) => {
    if (typeof value === 'object') {
      return flattenObject(value, [...prefix, key], acc);
    } else {
      return { ...acc, [[...prefix, key].join('.')]: value };
    }
  }, acc);
};
