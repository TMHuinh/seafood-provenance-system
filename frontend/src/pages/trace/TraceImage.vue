<script setup lang="ts">
import { ref, watch } from 'vue'
const props = defineProps<{ src: string; alt: string; caption: string }>()
const failed = ref(false)
watch(() => props.src, () => { failed.value = false })
</script>

<template>
  <figure class="trace-image">
    <a :href="src" target="_blank" rel="noopener noreferrer" :aria-label="`${caption} — mở ảnh gốc trong tab mới`">
      <img v-if="!failed" :src="src" :alt="alt" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="failed = true" />
      <span v-else class="image-fallback" role="status">Không tải được ảnh. Bấm để thử mở ảnh gốc.</span>
      <span class="image-caption"><span>{{ caption }}</span><span class="image-action">Xem ảnh gốc ↗</span></span>
    </a>
    <figcaption>Ảnh do đơn vị cung cấp, minh họa cho bản ghi này.</figcaption>
  </figure>
</template>

<style scoped>
.trace-image { width: 100%; max-width: 480px; margin: 16px 0 8px; }
.trace-image a { display: block; overflow: hidden; border: 1px solid #dae6e0; border-radius: 14px; color: #203e3b; background: #f3f8f5; text-decoration: none; }
.trace-image a:hover { border-color: #176e59; }
.trace-image a:focus-visible { outline: 3px solid #176e59; outline-offset: 4px; }
.trace-image img { display: block; width: 100%; height: auto; max-height: 320px; object-fit: contain; }
.image-caption { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 12px; padding: 10px 14px; font-size: 12px; font-weight: 600; }
.image-action { color: #176e59; }
.image-fallback { display: block; padding: 24px 16px; font-size: 13px; }
figcaption { margin-top: 6px; color: #56746a; font-size: 11px; line-height: 1.6; }
</style>
