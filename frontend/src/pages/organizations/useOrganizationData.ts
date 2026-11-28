import { onScopeDispose, ref, shallowRef, watch, type WatchSource } from 'vue'
import { errorText } from './model'

export function useOrganizationData<T>(scope: WatchSource, fetchData: () => Promise<T>) {
  const data = shallowRef<T>()
  const loading = ref(true)
  const error = ref('')
  let version = 0

  async function load() {
    const request = ++version
    data.value = undefined
    error.value = ''
    loading.value = true
    try {
      const result = await fetchData()
      if (request === version) data.value = result
    } catch (cause) {
      if (request === version) error.value = errorText(cause)
    } finally {
      if (request === version) loading.value = false
    }
  }

  watch(scope, load, { immediate: true })
  onScopeDispose(() => { version++ })

  return { data, loading, error, load }
}
