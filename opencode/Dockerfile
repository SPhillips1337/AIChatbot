FROM php:8.2-apache

# Install OpenSSH server
RUN apt-get update && \
    apt-get install -y openssh-server && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Configure SSH
RUN mkdir -p /var/run/sshd && \
    sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config

# Create SSH user
RUN useradd -m -s /bin/bash opencodeuser && \
    echo "opencodeuser:opencodepass" | chpasswd

# Expose SSH port
EXPOSE 22

# Start both Apache and SSH
COPY start-services.sh /start-services.sh
RUN chmod +x /start-services.sh
CMD ["/start-services.sh"]