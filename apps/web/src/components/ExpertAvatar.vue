<script setup lang="ts">
import { computed } from "vue";
import { expertAvatarAppearance } from "../utils/expert-avatar.js";

const props = withDefaults(defineProps<{
  expertId?: string;
  name?: string;
  size?: number;
}>(), { expertId: "", name: "", size: 20 });

const appearance = computed(() => expertAvatarAppearance(props.expertId, props.name));
const avatarStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  "--avatar-bg": appearance.value.background,
  "--avatar-hair": appearance.value.hair,
  "--avatar-clothing": appearance.value.clothing,
  "--avatar-skin": appearance.value.skin,
}));
</script>

<template>
  <span class="expert-avatar" :class="`hair-style-${appearance.hairStyle}`" :style="avatarStyle" role="img" :aria-label="`${name || '专家'}头像`">
    <span class="avatar-body" />
    <span class="avatar-neck" />
    <span class="avatar-face">
      <span class="avatar-hair" />
      <i class="avatar-eye left" />
      <i class="avatar-eye right" />
      <i class="avatar-nose" />
      <i class="avatar-mouth" />
      <i v-if="appearance.glasses" class="avatar-glasses" />
      <i v-if="appearance.accessory" class="avatar-accessory" />
    </span>
    <span class="avatar-hair-side left" />
    <span class="avatar-hair-side right" />
  </span>
</template>

<style scoped>
.expert-avatar {
  position: relative;
  display: inline-block;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 50%;
  background: var(--avatar-bg);
  isolation: isolate;
}

.avatar-body {
  position: absolute;
  z-index: 1;
  left: 14%;
  bottom: -30%;
  width: 72%;
  height: 68%;
  border-radius: 48% 48% 0 0;
  background: var(--avatar-clothing);
}

.avatar-body::before {
  position: absolute;
  top: 18%;
  left: 47%;
  width: 9%;
  height: 65%;
  border-radius: 5px;
  background: rgb(255 255 255 / 72%);
  content: "";
}

.avatar-neck {
  position: absolute;
  z-index: 2;
  top: 58%;
  left: 42%;
  width: 16%;
  height: 16%;
  background: var(--avatar-skin);
}

.avatar-face {
  position: absolute;
  z-index: 3;
  top: 18%;
  left: 25%;
  width: 50%;
  height: 52%;
  overflow: hidden;
  border-radius: 45% 45% 43% 43%;
  background: var(--avatar-skin);
  box-shadow: inset 0 -1px 0 rgb(100 55 35 / 12%);
}

.avatar-hair {
  position: absolute;
  z-index: 1;
  top: -16%;
  left: -6%;
  width: 112%;
  height: 44%;
  border-radius: 50% 50% 32% 24%;
  background: var(--avatar-hair);
}

.hair-style-1 .avatar-hair { top: -22%; height: 55%; border-radius: 45% 55% 24% 24%; }
.hair-style-2 .avatar-hair { top: -14%; height: 39%; border-radius: 48% 52% 45% 18%; }
.hair-style-3 .avatar-hair { top: -23%; height: 54%; border-radius: 52% 48% 34% 38%; }

.avatar-eye {
  position: absolute;
  z-index: 2;
  top: 54%;
  width: 7%;
  height: 6%;
  border-radius: 50%;
  background: #342c2b;
}

.avatar-eye.left { left: 28%; }
.avatar-eye.right { right: 28%; }

.avatar-nose {
  position: absolute;
  z-index: 2;
  top: 56%;
  left: 47%;
  width: 7%;
  height: 16%;
  border-right: 1px solid rgb(126 74 55 / 35%);
  transform: rotate(8deg);
}

.avatar-mouth {
  position: absolute;
  z-index: 2;
  top: 76%;
  left: 42%;
  width: 17%;
  height: 7%;
  border-bottom: 1px solid #a84f53;
  border-radius: 50%;
}

.avatar-glasses {
  position: absolute;
  z-index: 3;
  top: 48%;
  left: 16%;
  width: 68%;
  height: 17%;
  border: 1px solid #445261;
  border-radius: 5px;
  background: linear-gradient(90deg, transparent 46%, #445261 46%, #445261 53%, transparent 53%);
}

.avatar-accessory {
  position: absolute;
  z-index: 2;
  top: 52%;
  right: 4%;
  width: 9%;
  height: 9%;
  border: 1px solid #d89c35;
  border-radius: 50%;
  background: #fff0a8;
}

.avatar-hair-side {
  position: absolute;
  z-index: 4;
  top: 30%;
  width: 13%;
  height: 36%;
  border-radius: 40%;
  background: var(--avatar-hair);
}

.avatar-hair-side.left { left: 23%; }
.avatar-hair-side.right { right: 23%; }
</style>
