type ResettableStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>

export function resetLocalData(storage: ResettableStorage) {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith('watchtower-')) keys.push(key)
  }
  for (const key of keys) storage.removeItem(key)
}
