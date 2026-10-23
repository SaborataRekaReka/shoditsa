/** The new web application is the default. The embedded Yandex bundle keeps its own navigation. */
export const APPLICATION_DESIGN = import.meta.env.MODE !== 'yandex'
  || import.meta.env.VITE_LOCAL_REDESIGN === '1'
  || import.meta.env.VITE_QUEST_STUDY === '1'
