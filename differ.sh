# Strip all context lines
diff_lines="$(grep '^[><+-] ' | sed 's/^+/>/;s/^-/</')" || exit 0

# For each line, count the number of lines with the same content in the
# "left" and "right" diffs. If the numbers are not the same, then the line
# was either not moved or it's not obvious where it was moved, so the line
# is printed.
while IFS= read -r line
do
    contents="${line:2}"
    count_removes="$(grep -cFxe "< $contents" <<< "$diff_lines" || true)"
    count_adds="$(grep -cFxe "> $contents" <<< "$diff_lines" || true)"
    if [[ "$count_removes" -eq "$count_adds" ]]
    then
        # Line has been moved; skip it.
        continue
    fi

    echo "$line"
done <<< "$diff_lines"

if [ "${line+defined}" = defined ]
then
    printf "$line"
fi
