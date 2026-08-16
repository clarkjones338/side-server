import { AsyncLocalStorage } from 'async_hooks';
import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';

export const transactionContext = new AsyncLocalStorage<PoolClient>();

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
	raw?: string | [string, ...PrimitiveValue[]],
};

export type WhereValue = PrimitiveValue | PrimitiveValue[] | WhereOperator;
export type WhereClause = {
	[key: string]: WhereValue | WhereClause[] | WhereClause | undefined,
	OR?: WhereClause[],
	AND?: WhereClause[],
	NOT?: WhereClause,
};
export type QueryParams = PrimitiveValue[];

export const eq = (val: PrimitiveValue): WhereOperator => ({ eq: val });
export const neq = (val: PrimitiveValue): WhereOperator => ({ neq: val });
export const gt = (val: number | string | Date | bigint): WhereOperator => ({ gt: val });
export const gte = (val: number | string | Date | bigint): WhereOperator => ({ gte: val });
export const lt = (val: number | string | Date | bigint): WhereOperator => ({ lt: val });
export const lte = (val: number | string | Date | bigint): WhereOperator => ({ lte: val });
export const like = (val: string): WhereOperator => ({ like: val });
export const notLike = (val: string): WhereOperator => ({ notLike: val });
export const ilike = (val: string): WhereOperator => ({ ilike: val });
export const notIlike = (val: string): WhereOperator => ({ notIlike: val });
export const inArray = (val: PrimitiveValue[]): WhereOperator => ({ in: val });
export const notInArray = (val: PrimitiveValue[]): WhereOperator => ({ notIn: val });
export const isNull = (): WhereOperator => ({ isNull: true });
export const isNotNull = (): WhereOperator => ({ isNotNull: true });
export const between = (val1: number | string | Date | bigint, val2: number | string | Date | bigint): WhereOperator => ({ between: [val1, val2] });
export const notBetween = (val1: number | string | Date | bigint, val2: number | string | Date | bigint): WhereOperator => ({ notBetween: [val1, val2] });
export const sql = (strings: TemplateStringsArray, ...values: PrimitiveValue[]): WhereOperator => {
	let rawQuery = strings[0].replace(/\?/g, '??');
	for (let i = 1; i < strings.length; i++) {
		rawQuery += '?' + strings[i].replace(/\?/g, '??');
	}
	return { raw: [rawQuery, ...values] };
};

export interface BaseOptions {
	trx?: PoolClient;
}

export type JoinType = 'INNER JOIN' | 'LEFT JOIN' | 'RIGHT JOIN' | 'FULL JOIN';
export interface JoinOption {
	type?: JoinType;
	table: string;
	alias?: string;
	on: string;
	params?: QueryParams;
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
	joins?: JoinOption[];
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
	protected softDeleteColumn?: string;

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

	enableSoftDeletes(column = 'deleted_at') {
		this.softDeleteColumn = column;
		return this;
	}

	protected withSoftDelete(where: WhereClause): WhereClause {
		if (!this.softDeleteColumn) return where;
		if (where[this.softDeleteColumn] !== undefined) return where;
		return { ...where, [this.softDeleteColumn]: null };
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

		if (where.AND !== undefined) {
			if (Array.isArray(where.AND)) {
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
			}
			const andIndex = keys.indexOf('AND');
			if (andIndex !== -1) keys.splice(andIndex, 1);
		}

		if (where.OR !== undefined) {
			if (Array.isArray(where.OR)) {
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
			}
			const orIndex = keys.indexOf('OR');
			if (orIndex !== -1) keys.splice(orIndex, 1);
		}

		if (where.NOT !== undefined) {
			if (typeof where.NOT === 'object') {
				const res = this.buildWhere(where.NOT, idx);
				if (res.clause) {
					clauses.push(`NOT (${res.clause.replace(/^WHERE /, '')})`);
					values.push(...res.values);
					idx = res.nextIndex;
				}
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
					const arr = value as PrimitiveValue[];
					const hasNull = arr.includes(null);
					const nonNullValues = arr.filter((v): v is Exclude<PrimitiveValue, null> => v !== null);
					if (nonNullValues.length === 0) {
						clauses.push(`${quotedKey} IS NULL`);
					} else if (hasNull) {
						const placeholders = nonNullValues.map(() => `$${idx++}`).join(', ');
						clauses.push(`(${quotedKey} IN (${placeholders}) OR ${quotedKey} IS NULL)`);
						values.push(...nonNullValues);
					} else {
						const placeholders = arr.map(() => `$${idx++}`).join(', ');
						clauses.push(`${quotedKey} IN (${placeholders})`);
						values.push(...arr);
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
							const arr = opVal as PrimitiveValue[];
							const hasNull = arr.includes(null);
							const nonNull = arr.filter((v): v is Exclude<PrimitiveValue, null> => v !== null);
							if (nonNull.length === 0) {
								clauses.push(`${quotedKey} IS NULL`);
							} else if (hasNull) {
								const placeholders = nonNull.map(() => `$${idx++}`).join(', ');
								clauses.push(`(${quotedKey} IN (${placeholders}) OR ${quotedKey} IS NULL)`);
								values.push(...nonNull);
							} else {
								const placeholders = arr.map(() => `$${idx++}`).join(', ');
								clauses.push(`${quotedKey} IN (${placeholders})`);
								values.push(...arr);
							}
						} else {
							clauses.push('FALSE');
						}
						break;
					case 'notIn':
						if (Array.isArray(opVal) && opVal.length > 0) {
							const arr = opVal as PrimitiveValue[];
							const hasNull = arr.includes(null);
							const nonNull = arr.filter((v): v is Exclude<PrimitiveValue, null> => v !== null);
							if (nonNull.length === 0) {
								clauses.push(`${quotedKey} IS NOT NULL`);
							} else if (hasNull) {
								const placeholders = nonNull.map(() => `$${idx++}`).join(', ');
								clauses.push(`(${quotedKey} NOT IN (${placeholders}) AND ${quotedKey} IS NOT NULL)`);
								values.push(...nonNull);
							} else {
								const placeholders = arr.map(() => `$${idx++}`).join(', ');
								clauses.push(`${quotedKey} NOT IN (${placeholders})`);
								values.push(...arr);
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
							clauses.push(`(${opVal})`);
						} else if (Array.isArray(opVal) && opVal.length > 0 && typeof opVal[0] === 'string') {
							const rawQuery = opVal[0];
							const rawParams = opVal.slice(1);
							let processedQuery = '';
							let paramIdx = 0;
							for (let i = 0; i < rawQuery.length; i++) {
								if (rawQuery[i] === '?') {
									if (rawQuery[i + 1] === '?') {
										processedQuery += '?';
										i++;
									} else {
										processedQuery += `$${idx++}`;
										values.push(rawParams[paramIdx++]);
									}
								} else {
									processedQuery += rawQuery[i];
								}
							}
							clauses.push(`(${processedQuery})`);
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
		const client = trx || transactionContext.getStore();
		if (client) {
			return client.query<R>(query, params);
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

	buildRelationSql(rel: Relation, parentTableQuoted: string, parentTargetKey: string, nestedIncludes: string[]): string {
		let colList = `${this.quoted}.*`;

		if (nestedIncludes.length > 0) {
			const nestedSelects: string[] = [`${this.quoted}.*`];
			const groupedIncludes = new Map<string, string[]>();
			for (const inc of nestedIncludes) {
				const parts = inc.split('.');
				const relName = parts[0];
				const rest = parts.slice(1).join('.');
				if (!groupedIncludes.has(relName)) groupedIncludes.set(relName, []);
				if (rest) groupedIncludes.get(relName)!.push(rest);
			}

			for (const [relName, deeperIncludes] of Array.from(groupedIncludes.entries())) {
				const deeperRel = this.relations[relName];
				const deeperTable = this.db.getTable<any>(deeperRel.table);
				const deeperTargetKey = deeperRel.targetKey || (deeperRel.type === 'belongsTo' ? deeperTable.primaryKey : this.primaryKey);
				const nestedSql = deeperTable.buildRelationSql(deeperRel, this.quoted, deeperTargetKey, deeperIncludes);
				nestedSelects.push(`(${nestedSql}) AS ${this.quoteIdent(relName)}`);
			}
			colList = nestedSelects.join(', ');
		}

		const condition = rel.type === 'belongsTo' ?
			`${this.quoted}.${this.quoteIdent(rel.targetKey || this.primaryKey)} = ${parentTableQuoted}.${this.quoteIdent(rel.foreignKey)}` :
			`${this.quoted}.${this.quoteIdent(rel.foreignKey)} = ${parentTableQuoted}.${this.quoteIdent(parentTargetKey)}`;

		const softDel = this.softDeleteColumn ? ` AND ${this.quoted}.${this.quoteIdent(this.softDeleteColumn)} IS NULL` : '';

		if (rel.type === 'hasMany') {
			return `SELECT COALESCE(json_agg(row_to_json(sub.*)), '[]'::json) FROM (SELECT ${colList} FROM ${this.quoted} WHERE ${condition}${softDel}) sub`;
		} else {
			return `SELECT row_to_json(sub.*) FROM (SELECT ${colList} FROM ${this.quoted} WHERE ${condition}${softDel} LIMIT 1) sub`;
		}
	}

	private buildOrderBy(orderBy?: OrderByOption<T>, defaultOrder: OrderDirection = 'ASC'): string {
		if (!orderBy) return '';
		const validateOrder = (o: string) => ['ASC', 'DESC'].includes(o.toUpperCase()) ? o.toUpperCase() : 'ASC';
		const defOrder = validateOrder(defaultOrder);

		if (typeof orderBy === 'string') {
			const segments = orderBy.split(',').map(s => s.trim()).filter(Boolean);
			const items: string[] = [];
			for (const segment of segments) {
				const parts = segment.split(/\s+/);
				if (parts.length === 2 && ['asc', 'desc'].includes(parts[1].toLowerCase())) {
					items.push(`${this.quoteIdent(parts[0])} ${parts[1].toUpperCase()}`);
				} else {
					items.push(`${this.quoteIdent(segment)} ${defOrder}`);
				}
			}
			return items.length ? ` ORDER BY ${items.join(', ')}` : '';
		}
		if (Array.isArray(orderBy)) {
			const items: string[] = [];
			for (const item of orderBy) {
				if (typeof item === 'string') {
					items.push(`${this.quoteIdent(item)} ${defOrder}`);
				} else if (item && typeof item === 'object' && (item).column) {
					const order = validateOrder((item).order || defOrder);
					items.push(`${this.quoteIdent((item).column)} ${order}`);
				}
			}
			return items.length ? ` ORDER BY ${items.join(', ')}` : '';
		}
		if (typeof orderBy === 'object' && (orderBy).column) {
			const item = orderBy;
			return ` ORDER BY ${this.quoteIdent(item.column)} ${validateOrder(item.order || defOrder)}`;
		}
		return '';
	}

	private async processNestedRelations(rows: T[], include: string[]): Promise<T[]> {
		if (!rows.length || !include.length) return rows;

		const groupedIncludes = new Map<string, string[]>();
		for (const inc of include) {
			const parts = inc.split('.');
			const relName = parts[0];
			const rest = parts.slice(1).join('.');
			if (!groupedIncludes.has(relName)) groupedIncludes.set(relName, []);
			if (rest) groupedIncludes.get(relName)!.push(rest);
		}

		const parseDates = (obj: any) => {
			if (!obj || typeof obj !== 'object') return;
			for (const key of Object.keys(obj)) {
				const val = obj[key];
				if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d*)?(?:[-+]\d{2}:?\d{2}|Z)$/.test(val)) {
					obj[key] = new Date(val);
				} else if (val && typeof val === 'object') {
					parseDates(val);
				}
			}
		};

		for (const [relName, nestedIncludes] of Array.from(groupedIncludes.entries())) {
			const rel = this.relations[relName];
			if (!rel) continue;
			const relTable = this.db.getTable<any>(rel.table);

			for (const row of rows) {
				const nestedData = (row as any)[relName];
				if (!nestedData) continue;

				if (Array.isArray(nestedData)) {
					nestedData.forEach(parseDates);
					let processed = await relTable.afterSelect(nestedData);
					if (nestedIncludes.length > 0) processed = await relTable.processNestedRelations(processed, nestedIncludes);
					(row as any)[relName] = processed;
				} else {
					parseDates(nestedData);
					let processed = await relTable.afterSelect([nestedData]);
					if (nestedIncludes.length > 0) processed = await relTable.processNestedRelations(processed, nestedIncludes);
					(row as any)[relName] = processed[0];
				}
			}
		}
		return rows;
	}

	protected buildSelectQuery(where: WhereClause, columns: string[], options?: SelectOptions<T>) {
		where = this.withSoftDelete(where);
		let targetColumns = [...(columns.length > 0 ? columns : (options?.columns && options.columns.length > 0 ? options.columns : []))] as string[];
		const distinct = options?.distinct ? 'DISTINCT ' : '';

		const includeSelects: string[] = [];
		const useSubqueryForDistinct = !!(distinct && options?.include && options.include.length > 0);
		const parentAlias = useSubqueryForDistinct ? '"main"' : this.quoted;

		if (options?.include && options.include.length > 0) {
			const groupedIncludes = new Map<string, string[]>();
			for (const inc of options.include) {
				const parts = inc.split('.');
				const relName = parts[0];
				const rest = parts.slice(1).join('.');
				if (!groupedIncludes.has(relName)) groupedIncludes.set(relName, []);
				if (rest) groupedIncludes.get(relName)!.push(rest);
			}

			for (const [relName, nestedIncludes] of Array.from(groupedIncludes.entries())) {
				const rel = this.relations[relName];
				if (!rel) throw new Error(`Relation "${relName}" not defined on table "${this.name}".`);
				const relTable = this.db.getTable<any>(rel.table);
				const targetKey = rel.targetKey || (rel.type === 'belongsTo' ? relTable.primaryKey : this.primaryKey);

				if (useSubqueryForDistinct && targetColumns.length > 0 && !targetColumns.includes(targetKey)) {
					targetColumns.push(targetKey);
				}

				const nestedSql = relTable.buildRelationSql(rel, parentAlias, targetKey, nestedIncludes);
				includeSelects.push(`(${nestedSql}) AS ${this.quoteIdent(relName)}`);
			}
		}

		if (useSubqueryForDistinct && options?.orderBy && targetColumns.length > 0) {
			const orderCols: string[] = [];
			if (typeof options.orderBy === 'string') {
				const segments = options.orderBy.split(',').map(s => s.trim()).filter(Boolean);
				for (const segment of segments) {
					orderCols.push(segment.split(/\s+/)[0]);
				}
			} else if (Array.isArray(options.orderBy)) {
				for (const item of options.orderBy) {
					if (typeof item === 'string') orderCols.push(item);
					else if (item && typeof item === 'object' && (item as any).column) orderCols.push((item as any).column);
				}
			} else if (typeof options.orderBy === 'object' && (options.orderBy as any).column) {
				orderCols.push((options.orderBy as any).column);
			}
			for (const col of orderCols) {
				if (!targetColumns.includes(col)) targetColumns.push(col);
			}
		}

		const colListParts = targetColumns.length > 0 ? targetColumns.map(c => c.includes('.') ? this.quoteIdent(c) : `${this.quoted}.${this.quoteIdent(c)}`) : [`${this.quoted}.*`];

		let joinClause = '';
		let idx = 1;
		const params: QueryParams = [];

		if (options?.joins && options.joins.length > 0) {
			const validJoinTypes = ['INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN'];
			const joins = options.joins.map(j => {
				const type = j.type && validJoinTypes.includes(j.type.toUpperCase()) ? j.type.toUpperCase() : 'INNER JOIN';
				const alias = j.alias ? ` AS ${this.quoteIdent(j.alias)}` : '';
				let onClause = '';
				if (j.params && j.params.length > 0) {
					let paramIdx = 0;
					for (let i = 0; i < j.on.length; i++) {
						if (j.on[i] === '?') {
							if (j.on[i + 1] === '?') {
								onClause += '?';
								i++;
							} else {
								onClause += `$${idx++}`;
								params.push(j.params[paramIdx++]);
							}
						} else {
							onClause += j.on[i];
						}
					}
				} else {
					onClause = j.on;
				}
				return `${type} ${this.quoteIdent(j.table)}${alias} ON ${onClause}`;
			});
			joinClause = ` ${joins.join(' ')}`;
		}

		const { clause, values, nextIndex } = this.buildWhere(where, idx);
		params.push(...values);
		idx = nextIndex;
		let query = '';

		if (useSubqueryForDistinct) {
			query = `SELECT ${parentAlias}.*, ${includeSelects.join(', ')} FROM (SELECT DISTINCT ${colListParts.join(', ')} FROM ${this.quoted}${joinClause} ${clause}) ${parentAlias}`;
		} else {
			const finalColList = [...colListParts, ...includeSelects].join(', ');
			query = `SELECT ${distinct}${finalColList} FROM ${this.quoted}${joinClause} ${clause}`.trim();
		}

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
			let orderSql = this.buildOrderBy(options.orderBy, options.order ?? 'ASC');
			if (useSubqueryForDistinct) {
				orderSql = orderSql.split(`${this.quoted}.`).join(`${parentAlias}.`);
			}
			query += orderSql;
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
			const allowedLocks = ['FOR UPDATE', 'FOR SHARE', 'FOR NO KEY UPDATE', 'FOR KEY SHARE'];
			if (allowedLocks.includes(options.lock.toUpperCase())) {
				query += ` ${options.lock.toUpperCase()}`;
			}
		}

		return { query, params };
	}

	async select(where: WhereClause = {}, columns: string[] = [], options?: SelectOptions<T>): Promise<T[]> {
		const { query, params } = this.buildSelectQuery(where, columns, options);
		let rows = await this.executeQueryRows<T>(query, params, options?.trx);
		rows = await this.afterSelect(rows);
		if (options?.include && options.include.length > 0) {
			rows = await this.processNestedRelations(rows, options.include);
		}
		return rows;
	}

	prepareSelect(name: string, where: WhereClause = {}, columns: string[] = [], options?: SelectOptions<T>): { execute: (trx?: PoolClient) => Promise<T[]> } {
		const { query, params } = this.buildSelectQuery(where, columns, options);
		return {
			execute: async (trx?: PoolClient) => {
				const client = trx || transactionContext.getStore();
				const qObj = { name, text: query, values: params };
				let rows: T[] = [];
				if (client) {
					rows = (await client.query<T>(qObj)).rows;
				} else {
					rows = (await this.db.pool.query<T>(qObj)).rows;
				}
				rows = await this.afterSelect(rows);
				if (options?.include && options.include.length > 0) {
					rows = await this.processNestedRelations(rows, options.include);
				}
				return rows;
			},
		};
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

		const total = await this.count(where, options);
		const data = await this.select(where, (options.columns || []) as string[], { ...options, limit, offset });
		const totalPages = Math.ceil(total / limit);

		return { data, total, page, totalPages };
	}

	async insert<R = T>(data: Partial<T>, returning = '*', options?: BaseOptions): Promise<R | null> {
		// eslint-disable-next-line require-atomic-updates
		data = await this.beforeInsert(data);
		const keys = Object.keys(data) as (keyof T & string)[];
		if (keys.length === 0) throw new Error(`PGTable.insert(): data object is empty for table "${this.name}".`);

		const values: QueryParams = keys.map(k => data[k] as PrimitiveValue);
		const cols = keys.map(k => this.quoteIdent(k)).join(', ');
		const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

		const query = `INSERT INTO ${this.quoted} (${cols}) VALUES (${placeholders}) RETURNING ${returning}`;
		const res = await this.executeQuery<any>(query, values, options?.trx);
		let row = res.rows[0] ?? null;
		if (row && returning === '*') {
			row = await this.afterInsert(row);
			row = (await this.afterSelect([row]))[0];
		}
		return row as R;
	}

	async insertMany<R = T>(dataArray: Partial<T>[], returning = '*', options?: BaseOptions): Promise<R[]> {
		if (dataArray.length === 0) return [];
		dataArray = await Promise.all(dataArray.map(d => this.beforeInsert(d)));

		const keySet = new Set<string>();
		for (const row of dataArray) for (const k of Object.keys(row)) keySet.add(k);
		const keys = Array.from(keySet) as (keyof T & string)[];
		if (keys.length === 0) throw new Error(`PGTable.insertMany(): all data objects are empty for table "${this.name}".`);

		const cols = keys.map(k => this.quoteIdent(k)).join(', ');
		const results: any[] = [];
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
			const res = await this.executeQuery<any>(query, values, options?.trx);
			results.push(...res.rows);
		}

		if (returning === '*') {
			let finalRows: T[] = await Promise.all(results.map(r => this.afterInsert(r)));
			finalRows = await this.afterSelect(finalRows);
			return finalRows as unknown as Promise<R[]>;
		}
		return results as R[];
	}

	async upsert<R = T>(
		data: Partial<T>,
		conflictKeys: string[] = [this.primaryKey],
		returning = '*',
		options?: BaseOptions & { excludeFromUpdate?: string[] }
	): Promise<R | null> {
		// eslint-disable-next-line require-atomic-updates
		data = await this.beforeInsert(data);
		const keys = Object.keys(data) as (keyof T & string)[];
		if (keys.length === 0) throw new Error(`PGTable.upsert(): data object is empty for table "${this.name}".`);

		const values: QueryParams = keys.map(k => data[k] as PrimitiveValue);
		const cols = keys.map(k => this.quoteIdent(k)).join(', ');
		const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

		const updateKeys = keys.filter(k => !conflictKeys.includes(k) && !options?.excludeFromUpdate?.includes(k));
		const updateClauses = updateKeys.map(k => `${this.quoteIdent(k)} = EXCLUDED.${this.quoteIdent(k)}`).join(', ');

		let query = `INSERT INTO ${this.quoted} (${cols}) VALUES (${placeholders})`;
		if (conflictKeys.length > 0) {
			const conflictCols = conflictKeys.map(k => this.quoteIdent(k)).join(', ');
			query += ` ON CONFLICT (${conflictCols})`;
			if (updateClauses) {
				query += ` DO UPDATE SET ${updateClauses}`;
			} else if (returning) {
				query += ` DO UPDATE SET ${this.quoteIdent(conflictKeys[0])} = EXCLUDED.${this.quoteIdent(conflictKeys[0])}`;
			} else {
				query += ` DO NOTHING`;
			}
		}
		query += ` RETURNING ${returning}`;

		const res = await this.executeQuery<any>(query, values, options?.trx);
		let row = res.rows[0] ?? null;
		if (row && returning === '*') {
			row = await this.afterInsert(row);
			row = (await this.afterSelect([row]))[0];
		}
		return row as R;
	}

	async upsertMany<R = T>(
		dataArray: Partial<T>[],
		conflictKeys: string[] = [this.primaryKey],
		returning = '*',
		options?: BaseOptions & { excludeFromUpdate?: string[] }
	): Promise<R[]> {
		if (dataArray.length === 0) return [];
		dataArray = await Promise.all(dataArray.map(d => this.beforeInsert(d)));

		const keySet = new Set<string>();
		for (const row of dataArray) for (const k of Object.keys(row)) keySet.add(k);
		const keys = Array.from(keySet) as (keyof T & string)[];
		if (keys.length === 0) throw new Error(`PGTable.upsertMany(): all data objects are empty for table "${this.name}".`);

		const cols = keys.map(k => this.quoteIdent(k)).join(', ');
		const updateKeys = keys.filter(k => !conflictKeys.includes(k) && !options?.excludeFromUpdate?.includes(k));
		const updateClauses = updateKeys.map(k => `${this.quoteIdent(k)} = EXCLUDED.${this.quoteIdent(k)}`).join(', ');

		const results: any[] = [];
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

			let query = `INSERT INTO ${this.quoted} (${cols}) VALUES ${placeholders.join(', ')}`;
			if (conflictKeys.length > 0) {
				const conflictCols = conflictKeys.map(k => this.quoteIdent(k)).join(', ');
				query += ` ON CONFLICT (${conflictCols})`;
				if (updateClauses) {
					query += ` DO UPDATE SET ${updateClauses}`;
				} else if (returning) {
					query += ` DO UPDATE SET ${this.quoteIdent(conflictKeys[0])} = EXCLUDED.${this.quoteIdent(conflictKeys[0])}`;
				} else {
					query += ` DO NOTHING`;
				}
			}
			query += ` RETURNING ${returning}`;

			const res = await this.executeQuery<any>(query, values, options?.trx);
			results.push(...res.rows);
		}

		if (returning === '*') {
			let finalRows: T[] = await Promise.all(results.map(r => this.afterInsert(r)));
			finalRows = await this.afterSelect(finalRows);
			return finalRows as unknown as Promise<R[]>;
		}
		return results as R[];
	}

	async update(data: Partial<T>, where: WhereClause, options?: BaseOptions): Promise<number> {
		const originalClause = this.buildWhere(where).clause;
		if (!originalClause?.trim() || originalClause.trim() === 'WHERE FALSE') {
			throw new Error(`PGTable.update(): where clause resolved to empty, preventing unsafe full-table update. Use updateAll() to update all rows.`);
		}
		where = this.withSoftDelete(where);
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
		values.push(...whereValues);

		const query = `UPDATE ${this.quoted} SET ${setClauses.join(', ')} ${whereClause}`;
		const res = await this.executeQuery(query, values, options?.trx);
		if (res.rowCount && res.rowCount > 0) {
			await this.afterUpdate(where);
		}
		return res.rowCount ?? 0;
	}

	async updateAndReturn<R = T>(
		data: Partial<T>,
		where: WhereClause,
		returning = '*',
		options?: BaseOptions
	): Promise<R[]> {
		const originalClause = this.buildWhere(where).clause;
		if (!originalClause?.trim() || originalClause.trim() === 'WHERE FALSE') {
			throw new Error(`PGTable.updateAndReturn(): where clause resolved to empty, preventing unsafe full-table update.`);
		}
		where = this.withSoftDelete(where);
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
		values.push(...whereValues);

		const query = `UPDATE ${this.quoted} SET ${setClauses.join(', ')} ${whereClause} RETURNING ${returning}`;
		const res = await this.executeQuery<any>(query, values, options?.trx);
		if (res.rowCount && res.rowCount > 0) {
			await this.afterUpdate(where);
		}
		let finalRows = res.rows;
		if (returning === '*') finalRows = await this.afterSelect(finalRows);
		return finalRows as R[];
	}

	async updateAll(data: Partial<T>, options?: BaseOptions): Promise<number> {
		const where = this.withSoftDelete({});
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
		values.push(...whereValues);

		const query = `UPDATE ${this.quoted} SET ${setClauses.join(', ')} ${whereClause}`;
		const res = await this.executeQuery(query, values, options?.trx);
		if (res.rowCount && res.rowCount > 0) {
			await this.afterUpdate(where);
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
		where = this.withSoftDelete(where);
		const colQuoted = this.quoteIdent(column);
		let idx = 2;

		const updatedData = await this.beforeUpdate({} as Partial<T>, where);
		const keys = Object.keys(updatedData) as (keyof T & string)[];
		const setClauses: string[] = [`${colQuoted} = ${colQuoted} + $1`];
		const values: QueryParams = [amount];

		for (const key of keys) {
			if (key === column) continue;
			setClauses.push(`${this.quoteIdent(key)} = $${idx++}`);
			values.push(updatedData[key] as PrimitiveValue);
		}

		const { clause: whereClause, values: whereValues } = this.buildWhere(where, idx);
		if (!whereClause?.trim()) {
			throw new Error(`PGTable.increment(): where clause resolved to empty.`);
		}
		values.push(...whereValues);

		const query = `UPDATE ${this.quoted} SET ${setClauses.join(', ')} ${whereClause}`;
		const res = await this.executeQuery(query, values, options?.trx);
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

	async delete(where: WhereClause, options?: BaseOptions & { force?: boolean }): Promise<number> {
		const originalClause = this.buildWhere(where).clause;
		if (!originalClause?.trim() || originalClause.trim() === 'WHERE FALSE') {
			throw new Error(`PGTable.delete(): where clause resolved to empty, preventing unsafe full-table delete. Use deleteAll() or truncate() to clear the table.`);
		}
		if (this.softDeleteColumn && !options?.force) {
			return this.update({ [this.softDeleteColumn]: new Date() } as Partial<T>, where, options);
		}
		const finalWhere = options?.force ? where : this.withSoftDelete(where);
		const { clause, values } = this.buildWhere(finalWhere);
		await this.beforeDelete(finalWhere);
		const query = `DELETE FROM ${this.quoted} ${clause}`;
		const res = await this.executeQuery(query, values, options?.trx);
		if (res.rowCount && res.rowCount > 0) {
			await this.afterDelete(finalWhere);
		}
		return res.rowCount ?? 0;
	}

	async deleteAndReturn<R = T>(where: WhereClause, returning = '*', options?: BaseOptions & { force?: boolean }): Promise<R[]> {
		const originalClause = this.buildWhere(where).clause;
		if (!originalClause?.trim() || originalClause.trim() === 'WHERE FALSE') {
			throw new Error(`PGTable.deleteAndReturn(): where clause resolved to empty, preventing unsafe full-table delete.`);
		}
		if (this.softDeleteColumn && !options?.force) {
			return this.updateAndReturn<R>({ [this.softDeleteColumn]: new Date() } as Partial<T>, where, returning, options);
		}
		const finalWhere = options?.force ? where : this.withSoftDelete(where);
		const { clause, values } = this.buildWhere(finalWhere);
		await this.beforeDelete(finalWhere);
		const query = `DELETE FROM ${this.quoted} ${clause} RETURNING ${returning}`;
		const res = await this.executeQuery<any>(query, values, options?.trx);
		if (res.rowCount && res.rowCount > 0) {
			await this.afterDelete(finalWhere);
		}
		let finalRows = res.rows;
		if (returning === '*') finalRows = await this.afterSelect(finalRows);
		return finalRows as R[];
	}

	async deleteById(id: PrimitiveValue, options?: BaseOptions & { force?: boolean }): Promise<number> {
		if (id === undefined || id === null) throw new Error(`PGTable.deleteById(): id cannot be ${id}`);
		return this.delete({ [this.primaryKey]: id }, options);
	}

	async deleteAll(options?: BaseOptions & { force?: boolean }): Promise<number> {
		if (this.softDeleteColumn && !options?.force) {
			return this.updateAll({ [this.softDeleteColumn]: new Date() } as Partial<T>, options);
		}
		const finalWhere = options?.force ? {} : this.withSoftDelete({});
		const { clause, values } = this.buildWhere(finalWhere);
		await this.beforeDelete(finalWhere);
		const query = `DELETE FROM ${this.quoted} ${clause}`;
		const res = await this.executeQuery(query, values, options?.trx);
		if (res.rowCount && res.rowCount > 0) {
			await this.afterDelete(finalWhere);
		}
		return res.rowCount ?? 0;
	}

	async truncate(cascade = false, options?: BaseOptions): Promise<void> {
		const query = `TRUNCATE ${this.quoted}${cascade ? ' CASCADE' : ''}`;
		await this.executeQuery(query, [], options?.trx);
	}

	async count(where: WhereClause = {}, options?: SelectOptions<T>): Promise<number> {
		where = this.withSoftDelete(where);
		let joinClause = '';
		let idx = 1;
		const params: QueryParams = [];

		if (options?.joins && options.joins.length > 0) {
			const validJoinTypes = ['INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN'];
			const joins = options.joins.map(j => {
				const type = j.type && validJoinTypes.includes(j.type.toUpperCase()) ? j.type.toUpperCase() : 'INNER JOIN';
				const alias = j.alias ? ` AS ${this.quoteIdent(j.alias)}` : '';
				let onClause = '';
				if (j.params && j.params.length > 0) {
					let paramIdx = 0;
					for (let i = 0; i < j.on.length; i++) {
						if (j.on[i] === '?') {
							if (j.on[i + 1] === '?') {
								onClause += '?';
								i++;
							} else {
								onClause += `$${idx++}`;
								params.push(j.params[paramIdx++]);
							}
						} else {
							onClause += j.on[i];
						}
					}
				} else {
					onClause = j.on;
				}
				return `${type} ${this.quoteIdent(j.table)}${alias} ON ${onClause}`;
			});
			joinClause = ` ${joins.join(' ')}`;
		}

		const { clause, values, nextIndex } = this.buildWhere(where, idx);
		let query = '';
		params.push(...values);
		idx = nextIndex;

		if (options?.groupBy) {
			const groups = Array.isArray(options.groupBy) ? options.groupBy : [options.groupBy];
			const groupClause = ` GROUP BY ${groups.map(g => this.quoteIdent(g)).join(', ')}`;
			let havingClause = '';
			if (options?.having) {
				const havingRes = this.buildWhere(options.having, idx);
				if (havingRes.clause) {
					havingClause = ` HAVING ${havingRes.clause.replace(/^WHERE /, '')}`;
					params.push(...havingRes.values);
					idx = havingRes.nextIndex;
				}
			}
			query = `SELECT COUNT(*) AS count FROM (SELECT 1 FROM ${this.quoted}${joinClause} ${clause}${groupClause}${havingClause}) AS subquery`;
		} else if (options?.distinct) {
			query = `SELECT COUNT(DISTINCT ${this.quoted}.${this.quoteIdent(this.primaryKey)}) AS count FROM ${this.quoted}${joinClause} ${clause}`.trim();
		} else {
			query = `SELECT COUNT(*) AS count FROM ${this.quoted}${joinClause} ${clause}`.trim();
		}

		const row = (await this.executeQuery<{ count: string }>(query, params, options?.trx)).rows[0];
		return row ? parseInt(row.count) : 0;
	}

	async exists(where: WhereClause, options?: BaseOptions): Promise<boolean> {
		where = this.withSoftDelete(where);
		const { clause, values } = this.buildWhere(where);
		const query = `SELECT 1 FROM ${this.quoted} ${clause} LIMIT 1`.trim();
		const res = await this.executeQuery(query, values, options?.trx);
		return (res.rowCount ?? 0) > 0;
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
		const client = transactionContext.getStore();
		if (client) {
			return await client.query<R>(text, params);
		}
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
			const result = await transactionContext.run(client, () => callback(client));
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
