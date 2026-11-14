FROM python:3.13-slim
WORKDIR /app
COPY board.html.in build.py index.html server.py ./
RUN python build.py
ENV HOST=0.0.0.0 PORT=8080 REFRESH_TIMETABLE=1
EXPOSE 8080
CMD ["python", "server.py"]

