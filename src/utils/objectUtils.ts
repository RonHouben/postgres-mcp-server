type RecordUnknown = Record<string, unknown>;

export class ObjectUtils {
  static pick<T extends RecordUnknown, K extends keyof T>(object: T, ...keys: K[]) {
    return keys.reduce(
      (result, key) => {
        if (key in object) {
          return { ...result, [key]: object[key] };
        }
        return result;
      },
      {} as Pick<T, K>
    );
  }

  static omit<T extends RecordUnknown, K extends keyof T>(object: T, ...keys: K[]) {
    return Object.keys(object).reduce(
      (result, key) => {
        if (!keys.includes(key as K)) {
          return { ...result, [key]: object[key] };
        }

        return result;
      },
      {} as Omit<T, K>
    );
  }
}
