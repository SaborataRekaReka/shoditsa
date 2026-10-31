"""Describe intended media from the original theme, key and SIQ phase.

These are editorial inferences, not identified files, verified facts or replacements.
Never changes question wording, media links, approval or the source library.
"""
import argparse
import csv
from datetime import datetime, timezone
import json
from pathlib import Path


def describe(item, source, card):
    theme, answer = card['theme'], source['originalAnswer']
    phase, kind = item['phase'], item['kind']
    question = phase == 'question'
    expected = ''
    confidence = 'high'
    unknown = 'Исходный файл, точный кадр, монтаж и границы фрагмента не установлены.'
    brief = 'Подобрать отдельную редакторскую замену и проверить, что она соответствует ключу и не раскрывает ответ заранее.'
    if theme == 'Косплей 18+':
        number = sum(m['phase']=='question' for m in source['media'][:item['mediaIndex']+1])
        expected = (f'Фотография косплея персонажа «{answer}», изображение {number} из трёх в условии.' if question
                    else f'Изображение после раскрытия ответа «{answer}»: вероятно, персонаж или подтверждающий косплей.')
        if not question: confidence = 'medium'
        unknown = 'Неизвестны косплеер, фотосессия, костюм, поза, обрезка и порядок трёх фотографий. Тема не позволяет восстановить эти детали.'
        brief = 'Сохранить принцип узнавания персонажа по косплею. Любую замену оформить отдельно от утраченных оригиналов.'
    elif theme in ('Фильм по кадру', 'Сериал по кадру', 'Игра по скриншоту'):
        label = {'Фильм по кадру':'фильма','Сериал по кадру':'сериала','Игра по скриншоту':'игры'}[theme]
        expected = (f'Кадр или скриншот из {label} «{answer}» для узнавания названия.' if question
                    else f'Ответный видеоматериал, подтверждающий ответ «{answer}». Какой именно фрагмент использовал автор, неизвестно.')
        unknown = 'Неизвестны сцена, эпизод или уровень, версия изображения, обрезка и связь ответного ролика с вопросным кадром.'
    elif theme == 'ДилЕММА':
        expected = (f'Одно из трёх изображений для узнавания актрисы «{answer}».' if question
                    else f'Видеоматериал с подтверждением ответа «{answer}».')
        confidence = 'medium'
        unknown = 'Неизвестно, были ли это портреты, фрагменты лица или кадры из ролей, и как выглядело последовательное раскрытие.'
        brief = 'Сначала определить механику трёх изображений; одного случайного портрета недостаточно для точного воспроизведения задания.'
    elif theme == 'Компания по лого':
        expected = (f'Логотип или фрагмент логотипа компании «{answer}».' if question
                    else f'Ответное видео, подтверждающее компанию «{answer}».')
        unknown = 'Неизвестны версия логотипа, степень обрезки, скрытые надписи и вид ответной анимации.'
        if answer == 'Twitter':
            unknown += ' Ключ указывает Twitter; без изображения нельзя подменять его автоматически брендом X.'
    elif theme in ('Аниме по опенингу', 'Сериал по заставке'):
        label = 'опенинга аниме' if theme == 'Аниме по опенингу' else 'заставки сериала'
        expected = (f'Аудиофрагмент {label} «{answer}».' if question
                    else f'Видеофрагмент {label} «{answer}» после ответа.')
        unknown = 'Не установлены сезон, номер опенинга или вариант заставки, язык, версия записи и таймкоды.'
    elif theme == 'Фильм на слух':
        expected = (f'Аудиофрагмент для узнавания фильма «{answer}».' if question
                    else f'Видео, связанное с ответом «{answer}», вероятно раскрывающее источник аудио.')
        unknown = 'Неизвестно, был ли это диалог, музыка или иной звук; не установлены экранизация, дубляж и точная сцена.'
    elif theme == 'Игра по звуку':
        expected = (f'Узнаваемый аудиофрагмент из игры «{answer}».' if question
                    else f'Ответное видео, связанное с игрой «{answer}».')
        unknown = 'Неизвестен конкретный эффект, реплика или музыкальный фрагмент. Нельзя считать любой известный звук игры исходным.'
    elif theme == 'OST':
        expected = (f'Аудиофрагмент саундтрека произведения «{answer}».' if question
                    else f'{"Изображение" if kind=="image" else "Видео"}, подтверждающее произведение «{answer}».')
        unknown = 'Название конкретного трека, исполнитель, версия записи, таймкоды и вид ответного материала не указаны.'
    elif theme == 'Музыка':
        expected = (f'Аудиофрагмент композиции «{answer}».' if question
                    else f'{"Изображение" if kind=="image" else "Видеофрагмент"}, связанный с композицией «{answer}».')
        unknown = 'Исполнитель и название даны в ключе, но версия записи и границы отрывка неизвестны. Вид ответного материала не установлен.'
    elif theme == 'Глубокий сюжет':
        expected = (f'Изображение для узнавания аниме «{answer}».' if question
                    else f'Изображение, подтверждающее аниме «{answer}».')
        confidence = 'medium'
        unknown = 'Персонаж указан в ключе, но название темы не определяет кадр, ракурс, степень обрезки или содержание изображения.'
    elif theme == 'Зеркало души':
        expected = f'Изображение для узнавания актёра «{answer}». Возможно, использован крупный план глаз, но это только предположение по названию темы.' if question else f'Ответный видеоматериал с актёром «{answer}».'
        confidence = 'medium'
        unknown = 'Ключ определяет имя, но не подтверждает, что в условии были именно глаза, и не указывает исходную фотографию или роль.'
    elif theme == 'Что они скажут?':
        expected = (f'Видеосцена, оборванная до реплики из ключа «{answer}».' if question
                    else f'Продолжение видеосцены с репликой из ключа «{answer}».')
        if source['originalPrompt']:
            expected += ' Сохранившаяся подводка: «'+source['originalPrompt']+'».'
        unknown = 'Не установлены точный ролик, перевод, монтаж и место остановки. Фраза из ключа не идентифицирует исходный файл.'
        brief = 'Вопросный отрезок закончить до ключевой реплики; ответный отрезок должен продолжать ту же сцену и ту же версию озвучки.'
    elif theme == 'Что будет дальше?':
        expected = (f'Видеосцена перед событием, описанным в ключе: «{answer}».' if question
                    else f'Продолжение той же сцены с событием из ключа: «{answer}».')
        if source['originalPrompt']:
            expected += ' Сохранившаяся подводка: «'+source['originalPrompt']+'».'
        unknown = 'Событие известно по ключу, но точный источник, дубляж, монтаж и таймкод остановки не установлены.'
        brief = 'Подбирать два согласованных отрезка одной сцены: до события и его продолжение. Ключ не должен появиться в вопросном отрезке.'
    elif theme == 'Что рекламируют?':
        expected = (f'Рекламный ролик товара или бренда «{answer}» до раскрытия ответа.' if question
                    else f'Продолжение рекламы с раскрытием товара или бренда «{answer}».')
        confidence = 'medium'
        unknown = 'Известен только рекламируемый объект. Кампания, год, актёры, версия рекламы и момент остановки не определены.'
    elif theme == 'Youtube':
        expected = (f'Изображение для узнавания автора или канала «{answer}».' if question
                    else f'Ответное видео, связанное с автором или каналом «{answer}».')
        confidence = 'medium'
        unknown = 'Неизвестно, был ли в условии портрет, аватар, логотип канала или кадр из ролика; ответное видео также не определено.'
    else:
        expected = f'Медиа для задания темы «{theme}» с ключом «{answer}».'
        confidence = 'low'
    return dict(inferenceOnly=True, exactOriginalKnown=False, expectedContent=expected,
                confidence=confidence, answerKey=answer,
                basis='Исходные название темы и ключ ответа; тип, порядок и фаза медиавложения из SIQ.',
                unknowns=unknown, replacementBrief=brief)


def enrich(source_file, report_file):
    snapshot = json.loads(source_file.read_text(encoding='utf-8'))
    report = json.loads(report_file.read_text(encoding='utf-8'))
    cards = {q['id']:q for q in snapshot['questions']}
    for item in report['items']:
        item['context'] = describe(item, snapshot['sources'][item['identity']], cards[item['questionId']])
    report['contextualizedAt'] = datetime.now(timezone.utc).isoformat()
    report_file.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    with (report_file.parent/'unresolved.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        fields=['questionId','packTitle','theme','prompt','kind','phase','reference','httpStatus','reason','expectedContent','confidence','answerKey','unknowns','replacementBrief','checkedAt']
        writer=csv.DictWriter(stream,fieldnames=fields,extrasaction='ignore');writer.writeheader()
        for item in report['items']:
            if item['status']!='unresolved':continue
            values=dict(item,**item['context'])
            for key,value in values.items():
                if isinstance(value,str) and value.startswith(('=','+','-','@','\t','\r')):values[key]="'"+value
            writer.writerow(values)
    print(json.dumps(dict(items=len(report['items']),questions=len({i['questionId']for i in report['items']}),
                          high=sum(i['context']['confidence']=='high' for i in report['items']),
                          medium=sum(i['context']['confidence']=='medium' for i in report['items']),
                          low=sum(i['context']['confidence']=='low' for i in report['items'])),ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True);parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args();enrich(args.source,args.report)
