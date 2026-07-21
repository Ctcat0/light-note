import type {
  AccountRecord,
  CategoryRecord,
  UserInitializationStore,
  UserInitializationTransaction,
  UserRecord,
  UserSettingsRecord,
} from "../domain/types";

interface QueryResult {
  data: unknown[];
}

interface DocumentResult {
  data: unknown;
}

interface CloudQuery {
  where(query: Record<string, unknown>): CloudQuery;
  limit(limit: number): CloudQuery;
  get(): Promise<QueryResult>;
}

interface CloudDocument {
  get(): Promise<DocumentResult>;
  set(options: { data: Record<string, unknown> }): Promise<unknown>;
  update(options: { data: Record<string, unknown> }): Promise<unknown>;
}

interface CloudCollection extends CloudQuery {
  doc(documentId: string): CloudDocument;
}

interface CloudTransaction {
  collection(name: string): CloudCollection;
}

export interface CloudDatabase {
  collection(name: string): CloudCollection;
  runTransaction<T>(
    operation: (transaction: CloudTransaction) => Promise<T>,
    retryTimes?: number,
  ): Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isMissingDocumentError(error: unknown): boolean {
  const code = isRecord(error) ? error.errCode ?? error.code : undefined;
  const message =
    error instanceof Error
      ? error.message
      : isRecord(error) && typeof (error.errMsg ?? error.message) === "string"
        ? String(error.errMsg ?? error.message)
        : "";

  return (
    code === -502005 ||
    code === "-502005" ||
    code === "DATABASE_DOCUMENT_NOT_EXIST" ||
    code === "DOCUMENT_NOT_FOUND" ||
    /document.*(?:not exist|not found)|DATABASE_DOCUMENT_NOT_EXIST|-502005/i.test(
      message,
    )
  );
}

export function readDocumentData<TRecord>(value: unknown): TRecord | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return first === undefined ? null : (first as TRecord);
  }

  return value === null || value === undefined ? null : (value as TRecord);
}

function withoutId<TRecord extends { _id: string }>(
  record: TRecord,
): Record<string, unknown> {
  const entries = Object.entries(record).filter(([key]) => key !== "_id");

  return Object.fromEntries(entries);
}

async function getDocument<TRecord>(
  transaction: CloudTransaction,
  collectionName: string,
  documentId: string,
): Promise<TRecord | null> {
  try {
    const result = await transaction
      .collection(collectionName)
      .doc(documentId)
      .get();

    return readDocumentData<TRecord>(result.data);
  } catch (error) {
    if (isMissingDocumentError(error)) {
      return null;
    }

    throw error;
  }
}

async function createDocument<TRecord extends { _id: string }>(
  transaction: CloudTransaction,
  collectionName: string,
  record: TRecord,
): Promise<void> {
  await transaction.collection(collectionName).doc(record._id).set({
    data: withoutId(record),
  });
}

async function updateDocument<TRecord extends { _id: string }>(
  transaction: CloudTransaction,
  collectionName: string,
  record: TRecord,
): Promise<void> {
  await transaction.collection(collectionName).doc(record._id).update({
    data: withoutId(record),
  });
}

function createTransactionAdapter(
  transaction: CloudTransaction,
): UserInitializationTransaction {
  return {
    getUser: (userId) =>
      getDocument<UserRecord>(transaction, "users", userId),
    createUser: (user) => createDocument(transaction, "users", user),
    updateUser: (user) => updateDocument(transaction, "users", user),
    getSettings: (settingsId) =>
      getDocument<UserSettingsRecord>(
        transaction,
        "user_settings",
        settingsId,
      ),
    createSettings: (settings) =>
      createDocument(transaction, "user_settings", settings),
    updateSettings: (settings) =>
      updateDocument(transaction, "user_settings", settings),
    getCategory: (categoryId) =>
      getDocument<CategoryRecord>(transaction, "categories", categoryId),
    createCategory: (category) =>
      createDocument(transaction, "categories", category),
    getAccount: (accountId) =>
      getDocument<AccountRecord>(transaction, "accounts", accountId),
    createAccount: (account) =>
      createDocument(transaction, "accounts", account),
  };
}

export function createCloudBaseUserInitializationStore(
  database: CloudDatabase,
): UserInitializationStore {
  return {
    async findUserByOpenId(openId: string): Promise<UserRecord | null> {
      const result = await database
        .collection("users")
        .where({ openId })
        .limit(1)
        .get();
      const record = result.data[0];

      return record === undefined ? null : (record as UserRecord);
    },

    runTransaction: <T>(
      operation: (
        transaction: UserInitializationTransaction,
      ) => Promise<T>,
    ): Promise<T> =>
      database.runTransaction(
        (transaction) => operation(createTransactionAdapter(transaction)),
        3,
      ),
  };
}
