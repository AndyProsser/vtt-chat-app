-- What a chat line is: in character (chat, the default and what every earlier row is), say, do, or ooc
-- (out of character, kept out of the recording). `lang` is the language of a say line, a key from the
-- shared language table; NULL otherwise. docs/architecture/CHAT-COMMANDS.md.
ALTER TABLE chat_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE chat_messages ADD COLUMN lang TEXT;
