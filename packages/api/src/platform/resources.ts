import { platformPrisma } from './prisma';

export type ResourceLike = {
  resourceType: string;
  uid: string;
  [key: string]: any;
};

export class Resource {
  private readonly _type: string;
  private readonly _value: any;

  constructor(type: string, value: any) {
    this._type = type;
    this._value = value;
  }

  get uid() {
    return this._value.uid;
  }

  get type() {
    return this._type;
  }

  get path() {
    return `${this._type}/${this._value.uid}`;
  }

  getAsObject() {
    return this._value;
  }

  getAsString() {
    return JSON.stringify(this._value);
  }
}

export class ResourcePath {
  private readonly _path;
  private readonly _type: string;
  private readonly _uid?: string;
  private readonly _filter?: string[];

  constructor(path: string) {
    this._path = path;

    if (path.indexOf('/') === -1) {
      throw new Error(`Invalid resource path: ${path}`);
    }
    const index = path.indexOf('/');
    this._type = path.substring(0, index);
    const rest = path.substring(index + 1);

    if (rest.indexOf('[') > -1 || rest.indexOf(']') > -1) {
      const filter = rest.match(/^\[(.+)="(.+)"]$/);
      if (filter) {
        this._filter = filter.slice(1);
      } else {
        throw new Error(`Invalid resource path: ${path}`);
      }
    } else {
      this._uid = rest;
    }
  }

  get path() {
    return this._path;
  }
  get type() {
    return this._type;
  }
  get uid() {
    return this._uid;
  }
  get filter() {
    return this._filter;
  }
  get isWildcard() {
    return this.uid === '*';
  }
}

export interface ResourceResolver {
  resolve(path: string): Promise<Resource[]>;
}

export class PrismaResourceResolver implements ResourceResolver {
  private readonly prisma;

  constructor(prisma: typeof platformPrisma) {
    this.prisma = prisma;
  }

  async resolve(path: string): Promise<Resource[]> {
    const resourcePath = new ResourcePath(path);

    if (resourcePath.uid) {
      try {
        return this.prisma.$queryRawUnsafe<Resource[]>(
          `select *
             from "${resourcePath.type}"
             where "uid" = $1`,
          resourcePath.uid
        );
      } catch (error) {
        return [];
      }
    } else if (resourcePath.filter && resourcePath.filter.length === 2) {
      try {
        const [name, value] = resourcePath.filter;
        return this.prisma.$queryRawUnsafe<Resource[]>(
          `select *
             from "${resourcePath.type}"
             where "${name}" = $1`,
          value
        );
      } catch (error) {
        return [];
      }
    } else {
      throw new Error(`Invalid resource path: ${path}`);
    }
  }
}

export class ChainedResourceResolver implements ResourceResolver {
  private readonly resolvers: ResourceResolver[];
  constructor(...resolvers: ResourceResolver[]) {
    if (resolvers.length > 0) {
      this.resolvers = resolvers;
    } else {
      throw new Error('No resource resolvers provided');
    }
  }

  async resolve(path: string): Promise<Resource[]> {
    return this.resolvers.reduce(async (resultPromise, resolver) => {
      const result = await resultPromise;
      if (result && result.length > 0) {
        return resultPromise;
      } else {
        return resolver.resolve(path);
      }
    }, Promise.resolve<Resource[]>([]));
  }
}
