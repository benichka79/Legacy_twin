-- Guided interview: the question that elicited a recording travels with the
-- media object, giving the extraction pipeline conversational context.

alter table media_objects add column prompt text;
