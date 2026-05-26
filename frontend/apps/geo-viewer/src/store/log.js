const DB_NAME = "geo-viewer-logs";
const STORE_NAME = "logs";
const DB_VERSION = 1;
const MAX_LOGS = 300;

let dbPromise = null;

function canUseIndexedDb() {
	return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb() {
	if (!canUseIndexedDb()) return Promise.resolve(null);
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const request = window.indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
				store.createIndex("createdAt", "createdAt");
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	return dbPromise;
}

async function closeDb() {
	const db = await dbPromise?.catch(() => null);
	if (db) db.close();
	dbPromise = null;
}

async function persistLog(entry) {
	const db = await openDb();
	if (!db) return;
	await new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		tx.objectStore(STORE_NAME).add(entry);
		tx.oncomplete = resolve;
		tx.onerror = () => reject(tx.error);
	});
}

async function readLogs(limit = 80) {
	const db = await openDb();
	if (!db) return [];
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const index = tx.objectStore(STORE_NAME).index("createdAt");
		const request = index.openCursor(null, "prev");
		const rows = [];
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor || rows.length >= limit) {
				resolve(rows);
				return;
			}
			rows.push(cursor.value);
			cursor.continue();
		};
		request.onerror = () => reject(request.error);
	});
}

async function clearLogs() {
	const db = await openDb();
	if (!db) return;
	await new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		tx.objectStore(STORE_NAME).clear();
		tx.oncomplete = resolve;
		tx.onerror = () => reject(tx.error);
	});
}

async function trimLogs() {
	const rows = await readLogs(MAX_LOGS + 50);
	if (rows.length <= MAX_LOGS) return;
	const db = await openDb();
	if (!db) return;
	await new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		for (const row of rows.slice(0, rows.length - MAX_LOGS)) store.delete(row.id);
		tx.oncomplete = resolve;
		tx.onerror = () => reject(tx.error);
	});
}

export const logModule = {
	namespaced: true,
	state: () => ({
		items: [],
		limit: 80,
		maxLogs: MAX_LOGS
	}),
	mutations: {
		setItems(state, items) {
			state.items = items;
		},
		prepend(state, entry) {
			state.items = [entry, ...state.items.slice(0, state.limit - 1)];
		}
	},
	actions: {
		async init({ dispatch }) {
			if (!canUseIndexedDb()) return;
			await clearLogs();
			await dispatch("load");
		},
		async append({ commit }, { level, message, detail = "" }) {
			const entry = { level, message, detail, createdAt: Date.now() };
			commit("prepend", entry);
			await persistLog(entry);
			await trimLogs();
			return entry;
		},
		async load({ commit, state }, limit = state.limit) {
			const rows = await readLogs(limit);
			commit("setItems", rows);
			return rows;
		},
		async close() {
			await closeDb();
		}
	}
};
