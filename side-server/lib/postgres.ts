import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';

export type PGOptions = PoolConfig;

export type PrimitiveValue = string | number | boolean | null | Date | bigint | Buffer;

export type WhereOperator = {
	eq?: PrimitiveValue,
	neq?: PrimitiveValue,
	gt?: number | string | Date | bigint,
	gte?: number | string | Date | bigint,
	lt?: number | string | Date | bigint,
	lte?: number | string | Date | bigint,
	like?: string,
	notLike?: string,
	ilike?: string,
	notIlike?: string,
	in?: PrimitiveValue[],
	notIn?: PrimitiveValue[],
	isNull?: boolean,
	isNotNull?: boolean,
	between?: [number | string | Date | bigint, number | string | Date | bigint],
	notBetween?: [number | string | Date | bigint, number | string | Date | bigint],
	raw?: string,
};

export type WhereValue = PrimitiveValue | PrimitiveValue[] | WhereOperator;
export type WhereClause = {
	[key: string]: WhereValue | WhereClause[] | WhereClause | undefined,
	OR?: WhereClause[],
	AND?: WhereClause[],
	NOT?: WhereClause,
};
export type QueryParams = PrimitiveValue[];

export interface BaseOptions {
	trx?: PoolClient;
}

export type OrderDirection = 'ASC' | 'DESC' | 'asc' | 'desc';
export type OrderByItem<T = any> = { column: (keyof T & string) | string, order?: OrderDirection };
export type OrderByOption<T = any> =
	(keyof T & string) | string | OrderByItem<T> | ((keyof T & string) | string | OrderByItem<T>)[];

export interface SelectOptions<T = any> extends BaseOptions {
	limit?: number;
	offset?: number;
	orderBy?: OrderByOption<T>;
	order?: OrderDirection;
	include?: string[];
	columns?: ((keyof T & string) | string)[];
	distinct?: boolean;
	groupBy?: ((keyof T & string) | string)[] | (keyof T & string) | string;
	having?: WhereClause;
	lock?: 'FOR UPDATE' | 'FOR SHARE' | 'FOR NO KEY UPDATE' | 'FOR KEY SHARE';
}

export interface PaginateOptions<T = any> extends SelectOptions<T> {
	page?: number;
}

export interface PaginateResult<T> {
	data: T[];
	total: number;
	page: number;
	totalPages: number;
}

export type RelationType = 'hasMany' | 'belongsTo' | 'hasOne';

export interface Relation {
	type: RelationType;
	table: string;
	foreignKey: string;
	targetKey?: string;
}

function quoteIdentifier(ident: string): string {
	if (ident === '*') return '*';
	return ident.split('.').map(part => (part === '*' ? '*' : `"${part.replace(/"/g, '""')}"`)).join('.');
}

export class PGTable<T extends Record<string, any>> {
	readonly db: PGDatabaseManager;
	readonly name: string;
	readonly primaryKey: string;
	protected relations: Record<string, Relation> = {};

	protected quoteIdent(ident: string): string {
		return quoteIdentifier(ident);
	}

	get quoted(): string {
		return quoteIdentifier(this.name);
	}

	constructor(db: PGDatabaseManager, name: string, primaryKey = 'id') {
		this.db = db;
		this.name = name;
		this.primaryKey = primaryKey;
	}

	protected hasMany(name: string, options: { table: string, foreignKey: string, localKey?: string }) {
		this.relations[name] = {
			type: 'hasMany',
			table: options.table,
			foreignKey: options.foreignKey,
			targetKey: options.localKey || this.primaryKey,
		};
	}

	protected hasOne(name: string, options: { table: string, foreignKey: string, localKey?: string }) {
		this.relations[name] = {
			type: 'hasOne',
			table: options.table,
			foreignKey: options.foreignKey,
			targetKey: options.localKey || this.primaryKey,
		};
	}

	protected belongsTo(name: string, options: { table: string, foreignKey: string, targetKey?: string }) {
		this.relations[name] = {
			type: 'belongsTo',
			table: options.table,
			foreignKey: options.foreignKey,
			targetKey: options.targetKey,
		};
	}

	/* eslint-disable @typescript-eslint/require-await */
	protected async beforeInsert(data: Partial<T>): Promise<Partial<T>> { return data; }
	protected async afterInsert(data: T): Promise<T> { return data; }
	protected async beforeUpdate(data: Partial<T>, where: WhereClause): Promise<Partial<T>> { return data; }
	protected async afterUpdate(where: WhereClause): Promise<void> {}
	protected async beforeDelete(where: WhereClause): Promise<void> {}
	protected async afterDelete(where: WhereClause): Promise<void> {}
	protected async afterSelect(data: T[]): Promise<T[]> { return data; }
	/* eslint-enable @typescript-eslint/require-await */

	protected buildWhere(
		where: WhereClause,
		startIndex = 1
	): { clause: string, values: QueryParams, nextIndex: number } {
		const keys = Object.keys(where).filter(k => where[k] !== undefined);
		if (keys.length === 0) return { clause: '', values: [], nextIndex: startIndex };

		const clauses: string[] = [];
		const values: QueryParams = [];
		let idx = startIndex;

		if (where.AND && Array.isArray(where.AND)) {
			const andClauses: string[] = [];
			for (const andWhere of where.AND) {
				const res = this.buildWhere(andWhere, idx);
				if (res.clause) {
					andClauses.push(res.clause.replace(/^WHERE /, ''));
					values.push(...res.values);
					idx = res.nextIndex;
				}
			}
			if (andClauses.length > 0) {
				clauses.push(`(${andClauses.join(' AND ')})`);
			}
			const andIndex = keys.indexOf('AND');
			if (andIndex !== -1) keys.splice(andIndex, 1);
		}

		if (where.OR && Array.isArray(where.OR)) {
			const orClauses: string[] = [];
			for (const orWhere of where.OR) {
				const res = this.buildWhere(orWhere, idx);
				if (res.clause) {
					orClauses.push(res.clause.replace(/^WHERE /, ''));
					values.push(...res.values);
					idx = res.nextIndex;
				}
			}
			if (orClauses.length > 0) {
				clauses.push(`(${orClauses.join(' OR ')})`);
			}
			const orIndex = keys.indexOf('OR');
			if (orIndex !== -1) keys.splice(orIndex, 1);
		}

		if (where.NOT && typeof where.NOT === 'object') {
			const res = this.buildWhere(where.NOT, idx);
			if (res.clause) {
				clauses.push(`NOT (${res.clause.replace(/^WHERE /, '')})`);
				values.push(...res.values);
				idx = res.nextIndex;
			}
			const notIndex = keys.indexOf('NOT');
			if (notIndex !== -1) keys.splice(notIndex, 1);
		}

		for (const key of keys) {
			const value = where[key];
			if (value === undefined) continue;
			const quotedKey = this.quoteIdent(key);

			if (value === null) {
				clauses.push(`${quotedKey} IS NULL`);
			} else if (Array.isArray(value)) {
				if (value.length === 0) {
					clauses.push('FALSE');
				} else {
					const hasNull = value.includes(null);
					const nonNullValues = value.filter(v => v !== null);
					if (nonNullValues.length === 0) {
						clauses.push(`${quotedKey} IS NULL`);
					} else if (hasNull) {
						const placeholders = nonNullValues.map(() => `$${idx++}`).join(', ');
						clauses.push(`(${quotedKey} IN (${placeholders}) OR ${quotedKey} IS NULL)`);
						values.push(...nonNullValues);
					} else {
						const placeholders = value.map(() => `$${idx++}`).join(', ');
						clauses.push(`${quotedKey} IN (${placeholders})`);
						values.push(...value);
					}
				}
			} else if (typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
				const opKeys = Object.keys(value) as (keyof WhereOperator)[];
				for (const op of opKeys) {
					const opVal = (value as WhereOperator)[op];
					if (opVal === undefined) continue;

					switch (op) {
					case 'eq':
						if (opVal === null) {
							clauses.push(`${quotedKey} IS NULL`);
						} else {
							clauses.push(`${quotedKey} = $${idx++}`);
							values.push(opVal as PrimitiveValue);
						}
						break;
					case 'neq':
						if (opVal === null) {
							clauses.push(`${quotedKey} IS NOT NULL`);
						} else {
							clauses.push(`${quotedKey} != $${idx++}`);
							values.push(opVal as PrimitiveValue);
						}
						break;
					case 'gt':
						clauses.push(`${quotedKey} > $${idx++}`);
						values.push(opVal as PrimitiveValue);
						break;
					case 'gte':
						clauses.push(`${quotedKey} >= $${idx++}`);
						values.push(opVal as PrimitiveValue);
						break;
					case 'lt':
						clauses.push(`${quotedKey} < $${idx++}`);
						values.push(opVal as PrimitiveValue);
						break;
					case 'lte':
						clauses.push(`${quotedKey} <= $${idx++}`);
						values.push(opVal as PrimitiveValue);
						break;
					case 'like':
						clauses.push(`${quotedKey} LIKE $${idx++}`);
						values.push(opVal as PrimitiveValue);
						break;
					case 'notLike':
						clauses.push(`${quotedKey} NOT LIKE $${idx++}`);
						values.push(opVal as PrimitiveValue);
						break;
					case 'ilike':
						clauses.push(`${quotedKey} ILIKE $${idx++}`);
						values.push(opVal as PrimitiveValue);
						break;
					case 'notIlike':
						clauses.push(`${quotedKey} NOT ILIKE $${idx++}`);
						values.push(opVal as PrimitiveValue);
						break;
					case 'in':
						if (Array.isArray(opVal) && opVal.length > 0) {
							const hasNull = opVal.includes(null);
							const nonNull = opVal.filter(v => v !== null);
							if (nonNull.length === 0) {
								clauses.push(`${quotedKey} IS NULL`);
							} else if (hasNull) {
								const placeholders = nonNull.map(() => `$${idx++}`).join(', ');
								clauses.push(`(${quotedKey} IN (${placeholders}) OR ${quotedKey} IS NULL)`);
								values.push(...nonNull);
							} else {
								const placeholders = opVal.map(() => `$${idx++}`).join(', ');
								clauses.push(`${quotedKey} IN (${placeholders})`);
								values.push(...opVal);
							}
						} else {
							clauses.push('FALSE');
						}
						break;
					case 'notIn':
						if (Array.isArray(opVal) && opVal.length > 0) {
							const hasNull = opVal.includes(null);
							const nonNull = opVal.filter(v => v !== null);
							if (nonNull.length === 0) {
								clauses.push(`${quotedKey} IS NOT NULL`);
							} else if (hasNull) {
								const placeholders = nonNull.map(() => `$${idx++}`).join(', ');
								clauses.push(`(${quotedKey} NOT IN (${placeholders}) AND ${quotedKey} IS NOT NULL)`);
								values.push(...nonNull);
							} else {
								const placeholders = opVal.map(() => `$${idx++}`).join(', ');
								clauses.push(`${quotedKey} NOT IN (${placeholders})`);
								values.push(...opVal);
							}
						} else {
							clauses.push('TRUE');
						}
						break;
					case 'isNull':
						clauses.push(`${quotedKey} IS ${opVal ? 'NULL' : 'NOT NULL'}`);
						break;
					case 'isNotNull':
						clauses.push(`${quotedKey} IS ${opVal ? 'NOT NULL' : 'NULL'}`);
						break;
					case 'between':
						if (Array.isArray(opVal) && opVal.length === 2) {
							clauses.push(`${quotedKey} BETWEEN $${idx++} AND $${idx++}`);
							values.push(opVal[0], opVal[1]);
						}
						break;
					case 'notBetween':
						if (Array.isArray(opVal) && opVal.length === 2) {
							clauses.push(`${quotedKey} NOT BETWEEN $${idx++} AND $${idx++}`);
							values.push(opVal[0], opVal[1]);
						}
						break;
					case 'raw':
						if (typeof opVal === 'string') {
							clauses.push(opVal);
						}
						break;
					}
				}
			} else {
				clauses.push(`${quotedKey} = $${idx++}`);
				values.push(value as PrimitiveValue);
			}
		}

		return { clause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values, nextIndex: idx };
	}

	protected async executeQuery<R extends QueryResultRow = QueryResultRow>(
		query: string,
		params?: QueryParams,
		trx?: PoolClient
	): Promise<QueryResult<R>> {
		if (trx) {
			return trx.query<R>(query, params);
		}
		return this.db.query<R>(query, params);
	}

	protected async executeQueryRows<R extends QueryResultRow = QueryResultRow>(
		query: string,
		params?: QueryParams,
		trx?: PoolClient
	): Promise<R[]> {
		return (await this.executeQuery<R>(query, params, trx)).rows;
	}

	private async loadRelations(rows: T[], include: string[], trx?: PoolClient): Promise<T[]> {
		if (!rows.length || !include.length) return rows;

		for (const relName of include) {
			const rel = this.relations[relName];
			if (!rel) throw new Error(`Relation "${relName}" not defined on table "${this.name}".`);

			const relTable = this.db.getTable<any>(rel.table);
			const targetKey = rel.targetKey || (rel.type === 'belongsTo' ? relTable.primaryKey : this.primaryKey);

			if (rel.type === 'belongsTo') {
				const foreignKeys = Array.from(new Set(
					rows.map(r => r[rel.foreignKey] as PrimitiveValue).filter(v => v !== null && v !== undefined)
				));
				if (!foreignKeys.length) {
					for (const row of rows) (row as any)[relName] = null;
					continue;
				}

				const relatedRows = await relTable.select({ [targetKey]: { in: foreignKeys } }, [], { trx });
				const mapped = new Map<PrimitiveValue, any>();
				for (const r of relatedRows) mapped.set(r[targetKey] as PrimitiveValue, r);

				for (const row of rows) {
					(row as any)[relName] = mapped.get(row[rel.foreignKey] as PrimitiveValue) || null;
				}
			} else {
				const localKeys = Array.from(new Set(
					rows.map(r => r[targetKey] as PrimitiveValue).filter(v => v !== null && v !== undefined)
				));
				if (!localKeys.length) {
					for (const row of rows) (row as any)[relName] = rel.type === 'hasMany' ? [] : null;
					continue;
				}

				const relatedRows = await relTable.select({ [rel.foreignKey]: { in: localKeys } }, [], { trx });

				if (rel.type === 'hasMany') {
					const grouped = new Map<PrimitiveValue, any[]>();
					for (const r of relatedRows) {
						const fk = r[rel.foreignKey] as PrimitiveValue;
						if (!grouped.has(fk)) grouped.set(fk, []);
						grouped.get(fk)!.push(r);
					}
					for (const row of rows) {
						(row as any)[relName] = grouped.get(row[targetKey] as PrimitiveValue) || [];
					}
				} else {
					const mapped = new Map<PrimitiveValue, any>();
					for (const r of relatedRows) {
						const fk = r[rel.foreignKey] as PrimitiveValue;
						mapped.set(fk, r);
					}
					for (const row of rows) {
						(row as any)[relName] = mapped.get(row[targetKey] as PrimitiveValue) || null;
					}
				}
			}
		}
		return rows;
	}

	private buildOrderBy(orderBy?: OrderByOption<T>, defaultOrder: OrderDirection = 'ASC'): string {
		if (!orderBy) return '';
		if (typeof orderBy === 'string') {
			const parts = orderBy.trim().split(/\s+/);
			if (parts.length === 2 && ['asc', 'desc'].includes(parts[1].toLowerCase())) {
				return ` ORDER BY ${this.quoteIdent(parts[0])} ${parts[1].toUpperCase()}`;
			}
			return ` ORDER BY ${this.quoteIdent(orderBy)} ${defaultOrder.toUpperCase()}`;
		}
		if (Array.isArray(orderBy)) {
			const items: string[] = [];
			for (const item of orderBy) {
				if (typeof item === 'string') {
					items.push(`${this.quoteIdent(item)} ${defaultOrder.toUpperCase()}`);
				} else if (item && typeof item === 'object' && (item).column) {
					const order = ((item).order || defaultOrder).toUpperCase();
					items.push(`${this.quoteIdent((item).column)} ${order}`);
				}
			}
			return items.length ? ` ORDER BY ${items.join(', ')}` : '';
		}
		if (typeof orderBy === 'object' && (orderBy).column) {
			const item = orderBy;
			return ` ORDER BY ${this.quoteIdent(item.column)} ${(item.order || defaultOrder).toUpperCase()}`;
		}
		return '';
	}

	async select(
		where: WhereClause = {},
		columns: string[] = [],
		options?: SelectOptions<T>
	): Promise<T[]> {
		const targetColumns = columns.length > 0 ?
			columns : (options?.columns && options.columns.length > 0 ? options.columns : []);
		const distinct = options?.distinct ? 'DISTINCT ' : '';
		const colList = targetColumns.length > 0 ? targetColumns.map(c => this.quoteIdent(c)).join(', ') : '*';
		const { clause, values, nextIndex } = this.buildWhere(where);
		let query = `SELECT ${distinct}${colList} FROM ${this.quoted} ${clause}`.trim();

		let idx = nextIndex;
		const params: QueryParams = [...values];

		if (options?.groupBy) {
			const groups = Array.isArray(options.groupBy) ? options.groupBy : [options.groupBy];
			query += ` GROUP BY ${groups.map(g => this.quoteIdent(g)).join(', ')}`;
		}

		if (options?.having) {
			const havingRes = this.buildWhere(options.having, idx);
			if (havingRes.clause) {
				query += ` HAVING ${havingRes.clause.replace(/^WHERE /, '')}`;
				params.push(...havingRes.values);
				idx = havingRes.nextIndex;
			}
		}

		if (options?.orderBy) {
			query += this.buildOrderBy(options.orderBy, options.order ?? 'ASC');
		}

		if (options?.limit !== undefined) {
			query += ` LIMIT $${idx++}`;
			params.push(options.limit);
		}
		if (options?.offset !== undefined) {
			query += ` OFFSET $${idx++}`;
			params.push(options.offset);
		}
		if (options?.lock) {
			query += ` ${options.lock}`;
		}

		let rows = await this.executeQueryRows<T>(query, params, options?.trx);
		if (options?.include) {
			rows = await this.loadRelations(rows, options.include, options.trx);
		}
		return this.afterSelect(rows);
	}

	async selectOne(where: WhereClause = {}, columns: string[] = [], options?: SelectOptions<T>): Promise<T | null> {
		const rows = await this.select(where, columns, { ...options, limit: 1 });
		return rows[0] ?? null;
	}

	async findById(id: PrimitiveValue, columns: string[] = [], options?: SelectOptions<T>): Promise<T | null> {
		return this.selectOne({ [this.primaryKey]: id }, columns, options);
	}

	async paginate(
		where: WhereClause = {},
		options: PaginateOptions<T> = {}
	): Promise<PaginateResult<T>> {
		const page = Math.max(1, options.page ?? 1);
		const limit = Math.max(1, options.limit ?? 10);
		const offset = (page - 1) * limit;

		const total = await this.count(where, { trx: options.trx });
		const data = await this.select(where, (options.columns || []) as string[], { ...options, limit, offset });
		const totalPages = Math.ceil(total / limit);

		return { data, total, page, totalPages };
	}

	async insert(data: Partial<T>, returning = '*', options?: BaseOptions): Promise<T | null> {
		// eslint-disable-next-line require-atomic-updates
		data = await this.beforeInsert(data);
		const keys = Object.keys(data) as (keyof T & string)[];
		if (keys.length === 0) throw new Error(`PGTable.insert(): data object is empty for table "${this.name}".`);

		const values: QueryParams = keys.map(k => data[k] as PrimitiveValue);
		const cols = keys.map(k => this.quoteIdent(k)).join(', ');
		const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

		const query = `INSERT INTO ${this.quoted} (${cols}) VALUES (${placeholders}) RETURNING ${returning}`;
		const res = await this.executeQuery<T>(query, values, options?.trx);
		let row = res.rows[0] ?? null;
		if (row) row = await this.afterInsert(row);
		return row;
	}

	async insertMany(dataArray: Partial<T>[], returning = '*', options?: BaseOptions): Promise<T[]> {
		if (dataArray.length === 0) return [];
		dataArray = await Promise.all(dataArray.map(d => this.beforeInsert(d)));

		const keySet = new Set<string>();
		for (const row of dataArray) for (const k of Object.keys(row)) keySet.add(k);
		const keys = Array.from(keySet) as (keyof T & string)[];
		if (keys.length === 0) throw new Error(`PGTable.insertMany(): all data objects are empty for table "${this.name}".`);

		const cols = keys.map(k => this.quoteIdent(k)).join(', ');
		const results: T[] = [];
		const chunkSize = Math.max(1, Math.floor(60000 / Math.max(1, keys.length)));

		for (let i = 0; i < dataArray.length; i += chunkSize) {
			const chunk = dataArray.slice(i, i + chunkSize);
			const values: QueryParams = [];
			const placeholders: string[] = [];
			let idx = 1;

			for (const data of chunk) {
				const group: string[] = [];
				for (const key of keys) {
					const v = data[key];
					if (v === undefined) {
						group.push('DEFAULT');
					} else {
						group.push(`$${idx++}`);
						values.push(v as PrimitiveValue);
					}
				}
				placeholders.push(`(${group.join(', ')})`);
			}

			const query = `INSERT INTO ${this.quoted} (${cols}) VALUES ${placeholders.join(', ')} RETURNING ${returning}`;
			const res = await this.executeQuery<T>(query, values, options?.trx);
			results.push(...res.rows);
		}

		return Promise.all(results.map(r => this.afterInsert(r)));
	}

	async upsert(
		data: Partial<T>,
		conflictKeys: string[] = [this.primaryKey],
		returning = '*',
		options?: BaseOptions & { excludeFromUpdate?: string[] }
	): Promise<T | null> {
		// eslint-disable-next-line require-atomic-updates
		data = await this.beforeInsert(data);
		const keys = Object.keys(data) as (keyof T & string)[];
		if (keys.length === 0) throw new Error(`PGTable.upsert(): data object is empty for table "${this.name}".`);

		const values: QueryParams = keys.map(k => data[k] as PrimitiveValue);
		const cols = keys.map(k => this.quoteIdent(k)).join(', ');
		const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
		const conflictCols = conflictKeys.map(k => this.quoteIdent(k)).join(', ');

		const updateKeys = keys.filter(k => !conflictKeys.includes(k) && !options?.excludeFromUpdate?.includes(k));
		const updateClauses = updateKeys.map(k => `${this.quoteIdent(k)} = EXCLUDED.${this.quoteIdent(k)}`).join(', ');

		let query = `INSERT INTO ${this.quoted} (${cols}) VALUES (${placeholders}) ON CONFLICT (${conflictCols})`;
		query += updateClauses ? ` DO UPDATE SET ${updateClauses}` : ` DO NOTHING`;
		query += ` RETURNING ${returning}`;

		const res = await this.executeQuery<T>(query, values, options?.trx);
		let row = res.rows[0] ?? null;
		if (row) row = await this.afterInsert(row);
		return row;
	}

	async upsertMany(
		dataArray: Partial<T>[],
		conflictKeys: string[] = [this.primaryKey],
		returning = '*',
		options?: BaseOptions & { excludeFromUpdate?: string[] }
	): Promise<T[]> {
		if (dataArray.length === 0) return [];
		dataArray = await Promise.all(dataArray.map(d => this.beforeInsert(d)));

		const keySet = new Set<string>();
		for (const row of dataArray) for (const k of Object.keys(row)) keySet.add(k);
		const keys = Array.from(keySet) as (keyof T & string)[];
		if (keys.length === 0) throw new Error(`PGTable.upsertMany(): all data objects are empty for table "${this.name}".`);

		const cols = keys.map(k => this.quoteIdent(k)).join(', ');
		const conflictCols = conflictKeys.map(k => this.quoteIdent(k)).join(', ');
		const updateKeys = keys.filter(k => !conflictKeys.includes(k) && !options?.excludeFromUpdate?.includes(k));
		const updateClauses = updateKeys.map(k => `${this.quoteIdent(k)} = EXCLUDED.${this.quoteIdent(k)}`).join(', ');

		const results: T[] = [];
		const chunkSize = Math.max(1, Math.floor(60000 / Math.max(1, keys.length)));

		for (let i = 0; i < dataArray.length; i += chunkSize) {
			const chunk = dataArray.slice(i, i + chunkSize);
			const values: QueryParams = [];
			const placeholders: string[] = [];
			let idx = 1;

			for (const data of chunk) {
				const group: string[] = [];
				for (const key of keys) {
					const v = data[key];
					if (v === undefined) {
						group.push('DEFAULT');
					} else {
						group.push(`$${idx++}`);
						values.push(v as PrimitiveValue);
					}
				}
				placeholders.push(`(${group.join(', ')})`);
			}

			let query = `INSERT INTO ${this.quoted} (${cols}) VALUES ${placeholders.join(', ')} ON CONFLICT (${conflictCols})`;
			query += updateClauses ? ` DO UPDATE SET ${updateClauses}` : ` DO NOTHING`;
			query += ` RETURNING ${returning}`;

			const res = await this.executeQuery<T>(query, values, options?.trx);
			results.push(...res.rows);
		}

		return Promise.all(results.map(r => this.afterInsert(r)));
	}

	async update(data: Partial<T>, where: WhereClause, options?: BaseOptions): Promise<number> {
		data = await this.beforeUpdate(data, where);
		const keys = Object.keys(data) as (keyof T & string)[];
		if (keys.length === 0) return 0;

		const setClauses: string[] = [];
		const values: QueryParams = [];
		let idx = 1;

		for (const key of keys) {
			setClauses.push(`${this.quoteIdent(key)} = $${idx++}`);
			values.push(data[key] as PrimitiveValue);
		}

		const { clause: whereClause, values: whereValues } = this.buildWhere(where, idx);
		if (!whereClause?.trim()) {
			throw new Error(`PGTable.update(): where clause resolved to empty, preventing unsafe full-table update. Use updateAll() to update all rows.`);
		}
		values.push(...whereValues);

		const query = `UPDATE ${this.quoted} SET ${setClauses.join(', ')} ${whereClause}`;
		const res = await this.executeQuery(query, values, options?.trx);
		if (res.rowCount && res.rowCount > 0) {
			await this.afterUpdate(where);
		}
		return res.rowCount ?? 0;
	}

	async updateAndReturn(
		data: Partial<T>,
		where: WhereClause,
		returning = '*',
		options?: BaseOptions
	): Promise<T[]> {
		data = await this.beforeUpdate(data, where);
		const keys = Object.keys(data) as (keyof T & string)[];
		if (keys.length === 0) return [];

		const setClauses: string[] = [];
		const values: QueryParams = [];
		let idx = 1;

		for (const key of keys) {
			setClauses.push(`${this.quoteIdent(key)} = $${idx++}`);
			values.push(data[key] as PrimitiveValue);
		}

		const { clause: whereClause, values: whereValues } = this.buildWhere(where, idx);
		if (!whereClause?.trim()) {
			throw new Error(`PGTable.updateAndReturn(): where clause resolved to empty, preventing unsafe full-table update.`);
		}
		values.push(...whereValues);

		const query = `UPDATE ${this.quoted} SET ${setClauses.join(', ')} ${whereClause} RETURNING ${returning}`;
		const res = await this.executeQuery<T>(query, values, options?.trx);
		if (res.rowCount && res.rowCount > 0) {
			await this.afterUpdate(where);
		}
		return res.rows;
	}

	async updateAll(data: Partial<T>, options?: BaseOptions): Promise<number> {
		data = await this.beforeUpdate(data, {});
		const keys = Object.keys(data) as (keyof T & string)[];
		if (keys.length === 0) return 0;

		const setClauses: string[] = [];
		const values: QueryParams = [];
		let idx = 1;

		for (const key of keys) {
			setClauses.push(`${this.quoteIdent(key)} = $${idx++}`);
			values.push(data[key] as PrimitiveValue);
		}

		const query = `UPDATE ${this.quoted} SET ${setClauses.join(', ')}`;
		const res = await this.executeQuery(query, values, options?.trx);
		if (res.rowCount && res.rowCount > 0) {
			await this.afterUpdate({});
		}
		return res.rowCount ?? 0;
	}

	async updateById(id: PrimitiveValue, data: Partial<T>, options?: BaseOptions): Promise<number> {
		if (id === undefined || id === null) throw new Error(`PGTable.updateById(): id cannot be ${id}`);
		return this.update(data, { [this.primaryKey]: id }, options);
	}

	async increment(
		column: keyof T & string,
		amount = 1,
		where: WhereClause,
		options?: BaseOptions
	): Promise<number> {
		const colQuoted = this.quoteIdent(column);
		const { clause: whereClause, values: whereValues } = this.buildWhere(where, 2);
		if (!whereClause?.trim()) {
			throw new Error(`PGTable.increment(): where clause resolved to empty.`);
		}

		await this.beforeUpdate({} as Partial<T>, where);
		const query = `UPDATE ${this.quoted} SET ${colQuoted} = ${colQuoted} + $1 ${whereClause}`;
		const res = await this.executeQuery(query, [amount, ...whereValues], options?.trx);
		if (res.rowCount && res.rowCount > 0) {
			await this.afterUpdate(where);
		}
		return res.rowCount ?? 0;
	}

	async decrement(
		column: keyof T & string,
		amount = 1,
		where: WhereClause,
		options?: BaseOptions
	): Promise<number> {
		return this.increment(column, -amount, where, options);
	}

	async delete(where: WhereClause, options?: BaseOptions): Promise<number> {
		const { clause, values } = this.buildWhere(where);
		if (!clause?.trim()) {
			throw new Error(`PGTable.delete(): where clause resolved to empty, preventing unsafe full-table delete. Use deleteAll() or truncate() to clear the table.`);
		}
		await this.beforeDelete(where);
		const query = `DELETE FROM ${this.quoted} ${clause}`;
		const res = await this.executeQuery(query, values, options?.trx);
		if (res.rowCount && res.rowCount > 0) {
			await this.afterDelete(where);
		}
		return res.rowCount ?? 0;
	}

	async deleteAndReturn(where: WhereClause, returning = '*', options?: BaseOptions): Promise<T[]> {
		const { clause, values } = this.buildWhere(where);
		if (!clause?.trim()) {
			throw new Error(`PGTable.deleteAndReturn(): where clause resolved to empty, preventing unsafe full-table delete.`);
		}
		await this.beforeDelete(where);
		const query = `DELETE FROM ${this.quoted} ${clause} RETURNING ${returning}`;
		const res = await this.executeQuery<T>(query, values, options?.trx);
		if (res.rowCount && res.rowCount > 0) {
			await this.afterDelete(where);
		}
		return res.rows;
	}

	async deleteById(id: PrimitiveValue, options?: BaseOptions): Promise<number> {
		if (id === undefined || id === null) throw new Error(`PGTable.deleteById(): id cannot be ${id}`);
		return this.delete({ [this.primaryKey]: id }, options);
	}

	async deleteAll(options?: BaseOptions): Promise<number> {
		await this.beforeDelete({});
		const query = `DELETE FROM ${this.quoted}`;
		const res = await this.executeQuery(query, [], options?.trx);
		if (res.rowCount && res.rowCount > 0) {
			await this.afterDelete({});
		}
		return res.rowCount ?? 0;
	}

	async truncate(cascade = false, options?: BaseOptions): Promise<void> {
		const query = `TRUNCATE ${this.quoted}${cascade ? ' CASCADE' : ''}`;
		await this.executeQuery(query, [], options?.trx);
	}

	async count(where: WhereClause = {}, options?: BaseOptions): Promise<number> {
		const { clause, values } = this.buildWhere(where);
		const query = `SELECT COUNT(*) AS count FROM ${this.quoted} ${clause}`.trim();
		const row = (await this.executeQuery<{ count: string }>(query, values, options?.trx)).rows[0];
		return row ? parseInt(row.count) : 0;
	}

	async exists(where: WhereClause, options?: BaseOptions): Promise<boolean> {
		return (await this.count(where, options)) > 0;
	}
}

export class PGDatabaseManager {
	readonly pool: Pool;
	private readonly tables = new Map<string, PGTable<Record<string, any>>>();

	constructor(options?: PGOptions) {
		const configHost = process.env.PGHOST ||
			(global as any).Config?.postgres?.host || (global as any).Config?.pghost;
		const configUser = process.env.PGUSER ||
			(global as any).Config?.postgres?.user || (global as any).Config?.pguser;
		const configDatabase = process.env.PGDATABASE ||
			(global as any).Config?.postgres?.database || (global as any).Config?.pgdatabase;
		const configPassword = process.env.PGPASSWORD ||
			(global as any).Config?.postgres?.password || (global as any).Config?.pgpassword;
		const configPort = process.env.PGPORT ?
			parseInt(process.env.PGPORT) : ((global as any).Config?.postgres?.port || 5432);

		const baseConfig: PoolConfig = process.env.DATABASE_URL ?
			{ connectionString: process.env.DATABASE_URL } :
			typeof ((global as any).Config)?.postgres === 'string' ?
				{ connectionString: ((global as any).Config).postgres } :
				((global as any).Config)?.postgres?.connectionString ?
					{ connectionString: ((global as any).Config).postgres.connectionString } :
					((global as any).Config)?.postgres && typeof ((global as any).Config).postgres === 'object' ?
						{ ...((global as any).Config).postgres } :
						{
							host: configHost ?? '127.0.0.1',
							port: configPort,
							user: configUser ?? 'ubuntu',
							database: configDatabase ?? 'side-server',
							password: configPassword ?? undefined,
						};

		this.pool = new Pool({
			max: 20,
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 2_000,
			...baseConfig,
			...options,
		});

		this.pool.on('error', (err: Error) => {
			console.error('[PGDatabaseManager] Unexpected error on idle client:', err.message);
		});
	}

	async checkConnection(): Promise<boolean> {
		await this.pool.query('SELECT 1');
		return true;
	}

	async safeInit(moduleName: string, initQuery: string): Promise<boolean> {
		let attempts = 0;
		while (attempts < 2) {
			try {
				await this.checkConnection();
				break;
			} catch (err) {
				attempts++;
				if (attempts >= 2) {
					const msg = `[${moduleName}] PostgreSQL database connection unavailable (${(err as Error).message}).`;
					(global as any).Monitor ? (global as any).Monitor.warn(msg) : console.warn(msg);
					return false;
				}
				await new Promise(resolve => { setTimeout(resolve, 1000); });
			}
		}
		if (!initQuery) return true;
		try {
			await this.query(initQuery);
			return true;
		} catch (err) {
			const msg = `[${moduleName}] Failed to initialize PostgreSQL tables: ${(err as Error).message}`;
			(global as any).Monitor ? (global as any).Monitor.warn(msg) : console.warn(msg);
			return false;
		}
	}

	registerTable<T extends Record<string, any>>(table: PGTable<T>): void {
		this.tables.set(table.name, table as PGTable<Record<string, any>>);
	}

	hasTable(name: string): boolean {
		return this.tables.has(name);
	}

	getTable<T extends Record<string, any>>(name: string, primaryKey = 'id'): PGTable<T> {
		if (!this.tables.has(name)) {
			this.tables.set(name, new PGTable<T>(this, name, primaryKey));
		}
		return this.tables.get(name) as PGTable<T>;
	}

	async query<R extends QueryResultRow = QueryResultRow>(
		text: string,
		params?: QueryParams
	): Promise<QueryResult<R>> {
		return await this.pool.query<R>(text, params);
	}

	async queryRows<R extends QueryResultRow = QueryResultRow>(text: string, params?: QueryParams): Promise<R[]> {
		return (await this.query<R>(text, params)).rows;
	}

	async queryOne<R extends QueryResultRow = QueryResultRow>(text: string, params?: QueryParams): Promise<R | null> {
		return (await this.query<R>(text, params)).rows[0] ?? null;
	}

	async execute(text: string, params?: QueryParams): Promise<QueryResult> {
		return this.query(text, params);
	}

	async transaction<TResult>(callback: (client: PoolClient) => Promise<TResult>): Promise<TResult> {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			const result = await callback(client);
			await client.query('COMMIT');
			return result;
		} catch (err) {
			try {
				await client.query('ROLLBACK');
			} catch (rollbackErr) {
				console.error('[PGDatabaseManager] Transaction rollback error:', (rollbackErr as Error).message);
			}
			throw err;
		} finally {
			client.release();
		}
	}

	async destroy(): Promise<void> {
		await this.pool.end();
	}
}

export const PG = new PGDatabaseManager();
