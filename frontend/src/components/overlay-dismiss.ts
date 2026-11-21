import { watch, type WatchSource } from 'vue'

export function draftDismiss(readDraft: () => unknown, busy: () => boolean, opened?: WatchSource<boolean>) {
  let baseline = JSON.stringify(readDraft())
  const markClean = () => { baseline = JSON.stringify(readDraft()) }
  if (opened) watch(opened, (visible) => { if (visible) markClean() }, { flush: 'sync' })
  function dismiss(close: () => void) {
    if (busy()) return
    if (baseline !== JSON.stringify(readDraft()) &&
      !window.confirm('Bạn có thay đổi chưa lưu. Bạn có muốn bỏ thay đổi và đóng biểu mẫu không?')) return
    close()
  }
  return { dismiss, markClean }
}

export function dismissOnBackdrop(event: MouseEvent, close: () => void) {
  const dialog = event.currentTarget
  if (!(dialog instanceof HTMLDialogElement) || event.target !== dialog) return
  const rect = dialog.getBoundingClientRect()
  if (event.clientX < rect.left || event.clientX >= rect.right ||
      event.clientY < rect.top || event.clientY >= rect.bottom) close()
}
